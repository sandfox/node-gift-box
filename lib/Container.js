'use strict'

const graphlib = require('graphlib')

/**
 *  service provider definition
 *  - name: string
 *  - dependencies: array of strings
 *  - provider: function that returns a promise
 *  - lifetime: service lifetime!
 */

const LIFETIME_SINGLETON = 'singleton' // one per container
// const LIFETIME_SCOPED = 'scoped' // one per scoped "sub container"
const LIFETIME_TRANSIENT = 'transient' // new one every time

const TRANSIENT_SERVICENAME_SEPERATOR = '»'

class Container {
  constructor () {
    // Our dependency graph - each node is the string name of a service
    this._dependencyGraph = new graphlib.Graph({ directed: true })

    // Hold service provider definitions keyed by name
    this._serviceProviderDefinitions = new Map()

    // Holds Promise-wrapped output from factories, keyed by name
    this._singletonServices = new Map()
  }

  // adds a factories to the container for a given name
  addSingleton (name, provider, dependencies) {
    const _dependencies = Array.isArray(dependencies) ? dependencies : []
    // Store provider def internally
    this._add({
      name: name,
      dependencies: _dependencies,
      provider: provider,
      lifetime: LIFETIME_SINGLETON
    })
  }

  addTransient (name, provider, dependencies) {
    const _dependencies = Array.isArray(dependencies) ? dependencies : []
    // Store provider def internally
    this._add({
      name: name,
      dependencies: _dependencies,
      provider: provider,
      lifetime: LIFETIME_TRANSIENT
    })
  }

  _add (definition) {
    if (this._serviceProviderDefinitions.has(definition.name)) {
      throw new Error('provider already specified for this name')
    }

    // Silly check because we can only use text for node names
    if (definition.name.indexOf(TRANSIENT_SERVICENAME_SEPERATOR) !== -1) {
      throw new Error(`provider names cannot contain ${TRANSIENT_SERVICENAME_SEPERATOR}`)
    }

    // Store provider def internally
    this._serviceProviderDefinitions.set(definition.name, definition)
    // Add stuff to our graph :-)
    // graphlib creates any implicitly added nodes
    this._dependencyGraph.setNode(definition.name)
    definition.dependencies.forEach((dep) => {
      // The edge should point from "A" to "other thing" that depends on A
      this._dependencyGraph.setEdge(dep, definition.name)
    })

    // Check we haven't made our graph invalid with
    const cycles = findGraphCycles(this._dependencyGraph)

    if (cycles.length > 0) {
      throw new Error('Dependency Cycles Found: ' + cycles.map(_serialiseCycle).join(','))
    }
  }

  // Returns a promise thats resolves to the named thing we are after
  get (requestedServiceName) {
    // Have we already made it (or at least promising to make it?) because it's a singleton
    // short-circuit return
    if (this._singletonServices.has(requestedServiceName) === true) {
      return this._singletonServices.get(requestedServiceName)
    }

    // TODO: check scopedRequsts if subcontainer

    // do we even have a way to make it?
    if (this._serviceProviderDefinitions.has(requestedServiceName) === false) {
      return Promise.reject(new Error('Unknown service'))
    }

    // construct a object graph of services that we need to resolve to satisfy this request
    // that aren't already resolving / resolved
    // this is/will be a planned object graph
    const subgraph = this.createMissingObjectGraph(requestedServiceName)

    // Holds any transient services we may create for whilst satisfying this request
    // they are named service{delim}{counter}
    const transientServices = new Map()

    // construct an order for creating promises and chaining them together
    const promiseCreationOrder = graphlib.alg.topsort(subgraph)

    const predecessorHandler = (upstreamObjectName) => {
      // Because all upstream dependencies do exist and are resolved/resolving we do not need to existence check (lol)
      const upstreamServiceName = Container._objGraphNodeToServiceName(upstreamObjectName)
      const upstreamServiceDefinition = this._serviceProviderDefinitions.get(upstreamServiceName)
      if (upstreamServiceDefinition.lifetime === LIFETIME_TRANSIENT) {
        return transientServices.get(upstreamObjectName)
      }
      if (upstreamServiceDefinition.lifetime === LIFETIME_SINGLETON) {
        return this._singletonServices.get(upstreamServiceName)
      }
      // TODO: handle scoped stuff....
      // Default: something went terribley wrong....
      return Promise.reject(new Error(`We lost a service/object somehow: ${upstreamObjectName}`))
    }

    const newObjectNodeHandler = (nodeName) => {
      const serviceName = Container._objGraphNodeToServiceName(nodeName)
      const serviceDefinition = this._serviceProviderDefinitions.get(serviceName)
      const upstreamPromises = subgraph.predecessors(nodeName).map(predecessorHandler)

      const objectPromise = Container.createServiceProviderPromise(serviceDefinition, upstreamPromises)

      // check the lifetime of our promise and stash appropriately
      if (serviceDefinition.lifetime === LIFETIME_TRANSIENT) {
        transientServices.set(nodeName, objectPromise)
        return
      }
      if (serviceDefinition.lifetime === LIFETIME_SINGLETON) {
        this._singletonServices.set(serviceName, objectPromise)
        return
      }
    }

    promiseCreationOrder.forEach(newObjectNodeHandler)

    // this is the serviceProviderDefinition we want to resolve and hand back
    const requestedServiceDefinition = this._serviceProviderDefinitions.get(requestedServiceName)
    if (requestedServiceDefinition.lifetime === LIFETIME_TRANSIENT) {
      return transientServices.get(requestedServiceName)
    }
    if (requestedServiceDefinition.lifetime === LIFETIME_SINGLETON) {
      return this._singletonServices.get(requestedServiceName)
    }
    // If we get here everything is on fire and terrible with my code
  }

  static createServiceProviderPromise (serviceDefinition, dependencyPromises) {
    return Promise.all(dependencyPromises).then((values) => {
      // reduce values down to object to give to serviceProvider
      const providerDependeciesObj = serviceDefinition.dependencies.reduce((args, name, idx) => {
        args[name] = values[idx]
        return args
      }, {})

      // This is where we actually call the service provider
      // wrap in Promise as this lets us work with synchronous factories
      return Promise.resolve(serviceDefinition.provider(providerDependeciesObj))
    })
  }

  createMissingObjectGraph (startNode) {
    /**
     * create object graph starting at thing we want give to the user
     * singleton/scoped services should only be visited once, and are
     * named after the service
     * transient services can be visited multiple times and named
     * service {delimiter} number
     * the start/root node is always named after the it's service even
     * if it's transient
     */

    let id = 0

    const visited = new Set()
    const stack = new Set()
    const objectGraph = new graphlib.Graph({ directed: true })
    const depGraph = this._dependencyGraph

    const serviceDefs = this._serviceProviderDefinitions

    // This func is used to see if are interested in running the service provider for it.
    // For now we only check against our singleton instances, later we might check against
    // any scoped services (somehow)
    const boundsCheckFn = (serviceName) => {
      this._singletonServices.has(serviceName)
      // TODO check scoped services
    }

    const createObjectName = (serviceDef) => {
      if (serviceDef.name === startNode) {
        return serviceDef.name
      }
      if (serviceDef.lifetime === LIFETIME_SINGLETON) {
        return serviceDef.name
      }
      if (serviceDef.lifetime === LIFETIME_TRANSIENT) {
        return serviceDef.name + TRANSIENT_SERVICENAME_SEPERATOR + id++
      }
    }

    function visit (node, child) {
      if (boundsCheckFn(node) === false) {
        return
      }

      // TODO: this check is probably redundant as we already check for cycles
      // when adding anything to the dependency graph
      if (stack.has(node)) {
        throw new Error('object graph contains cycles')
      }

      // Get the serviceDef for the node
      const nodeServiceDef = serviceDefs.get(node)

      if (nodeServiceDef === undefined) {
        throw new Error(`no service provider defined for ${node}`)
      }

      const objGraphNodeName = createObjectName(nodeServiceDef)

      objectGraph.setNode(objGraphNodeName)

      if (child) {
        objectGraph.setEdge(objGraphNodeName, child)
      }

      if (visited.has(node)) {
        return
      }

      stack.add(node)
      // We only make singletone/scoped services as visited
      // transients can be visited multiple times
      if (nodeServiceDef.lifetime === LIFETIME_SINGLETON) {
        visited.add(node)
      }
      depGraph.predecessors(node).forEach(_node => visit(_node, objGraphNodeName))
      stack.delete(node)
    }

    visit(startNode)

    return objectGraph
  }

  static _objGraphNodeToServiceName (graphNodeName) {
    return graphNodeName.split(TRANSIENT_SERVICENAME_SEPERATOR)[0]
  }

}

module.exports = Container

/* Utility junk */
function _serialiseCycle (cycleArray) {
  return cycleArray.join(' -> ')
}

/**
 * Graph operations / functions
 */
function findGraphCycles (depGraph) {
  // Check if acylic (this test is faster than looking for actual cycles)
  if (graphlib.alg.isAcyclic(depGraph) === true) {
    return []
  }

  // Find some cycles and throw an error
  return graphlib.alg.findCycles(depGraph)
}
