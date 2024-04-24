import { Driver } from 'homey'
import { Thermostat, UponorHTTPClient } from '../../lib/UponorHTTPClient'

class UponorDriver extends Driver {

    async onPairListDevices(): Promise<any[]> {
        const discoveryStrategy = this.getDiscoveryStrategy()
        const discoveryResults = discoveryStrategy.getDiscoveryResults()
        const devices: any[] = []

        for await (let discoveryResult of Object.values(discoveryResults)) {
            const client = new UponorHTTPClient(discoveryResult.address)
            await client.syncAttributes()
            const thermostats = client.getThermostats()
            thermostats.forEach((thermostat: Thermostat) => {
                devices.push({
                    name: thermostat.name,
                    data: {
                        id: `${discoveryResult.id}_${thermostat.id}`,
                        MACAddress: discoveryResult.id,
                        controllerID: thermostat.controllerID,
                        thermostatID: thermostat.thermostatID,
                    },
                    settings: {
                        address: discoveryResult.address,
                    }
                })
            })
        }

        return devices
    }
}

module.exports = UponorDriver
