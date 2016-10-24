const tap = require('tap')
const Container = require('../lib/Container')

tap.test('sort of works?', function (t) {
  const c = new Container()

  const baseDep = {}

  c.addSingleton('root', function () {
    return Promise.resolve(baseDep)
  })

  c.addTransient('transient', function (deps) {
    return Promise.resolve({parent: deps.root})
  }, ['root'])

  c.addSingleton('singletonA', function (deps) {
    return Promise.resolve({parent: deps.transient})
  }, ['transient'])

  c.addSingleton('singletonB', function (deps) {
    return Promise.resolve({parent: deps.transient})
  }, ['transient'])

  c.addSingleton('target', function (deps) {
    return Promise.resolve({parentA: deps.singletonA, parentB: deps.singletonB})
  }, ['singletonA', 'singletonB'])

  c.get('target').then(function (service) {
    // each should gets it's own transient
    t.notEqual(service.parentA.parent, service.parentB.parent)
    // each transient should get the same root
    t.equal(service.parentA.parent.parent, service.parentB.parent.parent)
    // check root is what we put in
    t.equal(service.parentA.parent.parent, baseDep)
    t.end()
  })
})
