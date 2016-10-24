# Gift Box

Another dependency injection container for nodejs. Not particuarly fast, good, well designed, or anything else.

## Installation

```
npm install [--save] gift-box
```

## Concepts

_This documenation needs so much adding to it..._

- Service : Anything we might want to instantiate/fetch. Can be an object/function/primitive/etc
- ServiceProvider : A function that either returns a `Service` or a promise that resolves to `Service`
- ServiceDefinition: a grouping of 
- Container : Our box that holds definitions of `Service`s and their `ServiceProvider`s and understands the relationships between them
- Singleton Service : A service that is only instantiated once per container (not the same thing as singleton pattern)
- Transient Service: A service that is instantiated every single time is required


## Usage / API

### Instantiating a container

It is preferably to use the factory method `createContainer`

```
const container = require('gift-box').createContainer()
// or if you need access to the underlying "class"
const Container = require('gift-box').Container
const myContainer = new Container()
```

### addSingleton, addTransient

```
container.addSingleton('service', serviceProvider, ['array', 'of', 'named', 'services'])
```

Adds a definition for the named `service` to the container. Singleton services only get instantiated at most one per container. If multiple services depend on a Singleton service, each one will get the same instance.


```
container.addTransient('service', serviceProvider, ['array', 'of', 'named', 'services'])
```

Adds a definition for the named `service` to the container. Transient services get instantiated each time they are requested in a container. If multiple services depend on a Transient service, each one will get a new instance


`service` is the name of the service we are defining
`serviceProvider` is a function as mentioned in concepts (`ServiceProvider`)
`['array', 'of', 'named', 'services']` is an array of service names which this service is dependent on.

The order of adding service definitions to the container does not matter as long as you do not create a circular dependency chain (an `Error` will be thrown if you add a definition that would create such a situation)

### get

```
container.get('service')
```

Gets a service from the container. The container will calculate which dependencies are required to be created so that it can return the requested service. Any singleton services created will be cached internally and re-used.
This method returns a `Promise` that resolves either the service or a rejection if any service provider errors.

## Example

```
const container = require('gift-box').createContainer()

container.addSingleton('config', function(){
  return {db: process.env['POSTGRES']}
})

container.addTransient('client', function(deps){
  const dbUrl = deps.config.db
  return new DbClient(dbUrl)
}, ['config'])

// Later in another file
container.get('client').then(function(client){
  client.query('some thing')
})

```

## Internals

Add services creates nodes on an internal dependency graph. When a service is requested a subgraph is constructed of any services/objects that need to be instantiated to create the requested service.

## TODO

- Use a faster/better graph library or tree walking impl. (although maybe it's fast as it gets for what we're doing.)
- add apis's to allow outputting dot-format data so we can print/show dependency graphs
- add method to show calculated object / new-object graphs (and as above add dot output)
- Better docs or at least better links to stuff that explains the concepts we are using.
- Add scoped subcontainers
- lots more tests