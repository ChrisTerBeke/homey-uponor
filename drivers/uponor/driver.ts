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

        const thermostats = client.getThermostats()
        console.log('thermostats', thermostats)

        return thermostats.map((thermostat: Thermostat) => {
            return {
                name: thermostat.name,
                data: {
                    id: thermostat.id,
                    name: thermostat.name,
                    ip_address: '192.168.2.17',
                    controller_id: thermostat.controller_id,
                    thermostat_id: thermostat.thermostat_id,
                },
            }
        })
    }
}

module.exports = UponorDriver
