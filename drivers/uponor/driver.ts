import { Driver } from 'homey'
import { Thermostat, UponorHTTPClient } from '../../lib/UponorHTTPClient'

class UponorDriver extends Driver {

    async onPairListDevices(): Promise<any[]> {
        // TODO: fix discoveryResults, MAC search not working?
        // const discoveryStrategy = this.getDiscoveryStrategy()
        // const discoveryResults = discoveryStrategy.getDiscoveryResults()
        // console.log('discoveryResults', discoveryResults)
        const client = new UponorHTTPClient('192.168.2.17')
        await client.syncAttributes()

        const devices: any[] = []
        const thermostats = client.getThermostats()
        thermostats.forEach((thermostat: Thermostat) => {
            devices.push({
                name: thermostat.name,
                data: {
                    id: thermostat.id,
                    name: thermostat.name,
                    IPAddress: '192.168.2.17',
                    controllerID: thermostat.controllerID,
                    thermostatID: thermostat.thermostatID,
                },
            })
        })

        return devices
    }
}

module.exports = UponorDriver
