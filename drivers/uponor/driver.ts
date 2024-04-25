import { Driver } from 'homey'
import { UponorHTTPClient } from '../../lib/UponorHTTPClient'
import { PairSession } from 'homey/lib/Driver';

class UponorDriver extends Driver {

    private _customIpAddress: string | undefined

    async onPair(session: PairSession): Promise<void> {

        const driver = this

        session.setHandler('custom_ip_address', async function (address: string) {
            driver._customIpAddress = address
        })

        session.setHandler('list_devices', async function () {
            const discoveryStrategy = driver.getDiscoveryStrategy()
            const discoveryResults = discoveryStrategy.getDiscoveryResults()

            for await (let discoveryResult of Object.values(discoveryResults)) {
                return await driver._findDevices(discoveryResult.address, discoveryResult.id)
            }

            if (driver._customIpAddress) {
                const time = new Date().getTime()
                return await driver._findDevices(driver._customIpAddress, `custom_${time}`)
            }

            return []
        })
    }

    private async _findDevices(ipAddress: string, systemID: string): Promise<any[]> {
        const devices: any[] = []
        const client = new UponorHTTPClient(ipAddress)
        const connected = await client.testConnection()
        if (!connected) return devices

        await client.syncAttributes()
        client.getThermostats().forEach((thermostat) => {
            devices.push({
                name: thermostat.name,
                data: {
                    id: `${systemID}_${thermostat.id}`,
                    controllerID: thermostat.controllerID,
                    thermostatID: thermostat.thermostatID,
                },
                store: {
                    address: ipAddress,
                }
            })
        })

        return devices
    }
}

module.exports = UponorDriver
