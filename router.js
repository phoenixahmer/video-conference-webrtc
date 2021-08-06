'use strict'

module.exports = function (app, socketIoServer) {

  // render home.ejs on / route
  app.get('/', (req, res) => res.render('home'))

  // render room.ejs on /xyz route
  app.get('/:path', (req, res) =>
    req.params.path !== 'favicon.ico' &&
    res.render('room', { "hostAddress": socketIoServer }))

}