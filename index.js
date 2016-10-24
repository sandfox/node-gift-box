const Container = require('./lib/Container')

exports.Container = Container

exports.createContainer = function(){
  return new Container()
}