import sourceMapSupport from 'source-map-support'
sourceMapSupport.install()

import { App } from 'homey'
const { Log } = require('homey-log')

class UponorApp extends App {
  async onInit() {
    // @ts-ignore TS2339
    this.homeyLog = new Log({ homey: this.homey })
    this.log('UponorApp is running...')
  }
}

module.exports = UponorApp
