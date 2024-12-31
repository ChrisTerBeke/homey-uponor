import { Driver } from 'homey'
import { Thermostat, UponorHTTPClient } from '../../lib/UponorHTTPClient'
import { PairSession } from 'homey/lib/Driver'

export class UponorDriver extends Driver {

    private _client?: UponorHTTPClient

    getClient(): UponorHTTPClient {
        const ip_address = this.getIpAddress()
        if (!ip_address) throw new Error('IP address not discovered or set during pairing')
        if (!this._client) this._client = new UponorHTTPClient(ip_address)
        return this._client
    }

    getIpAddress(): string | undefined {
        return this.homey.settings.get('ip_address')
    }

    async setIpAddress(ipAddress: string): Promise<boolean> {
        return await this.getClient().updateAddress(ipAddress)
    }

    async onPair(session: PairSession): Promise<void> {
        session.setHandler('custom_ip_address', this._setCustomIpAddress.bind(this))
        session.setHandler('list_devices', this._listDevices.bind(this))
    }

    private async _setCustomIpAddress(address: string): Promise<void> {
        this.homey.settings.set('ip_address', address)
    }

    private async _listDevices(): Promise<any[]> {
        
        // when a custom IP address is set, only return devices for that address
        const ip_address = this.getIpAddress()
        if (ip_address) {
            return await this._findDevices(ip_address, `custom_${new Date().getTime()}`)
        }

        // otherwise discover devices on the network and use the first one found
        const discoveryStrategy = this.getDiscoveryStrategy()
        const discoveryResults = discoveryStrategy.getDiscoveryResults()
        const controller = Object.values(discoveryResults).pop()
        if (controller) {
            this.setIpAddress(controller.address)
            return await this._findDevices(controller.address, controller.id)
        }

        return []
    }

    private async _findDevices(ipAddress: string, systemID: string): Promise<any[]> {
        try {
            const connected = await this.getClient().testConnection()
            if (!connected) return []
            await this.getClient().syncAttributes()
            const debug = await this.getClient().debug()
            this.homey.settings.set('debug_devices', JSON.stringify(debug))
            const thermostats = Array.from(this.getClient().getThermostats().values())
            return thermostats.map(this._mapDevice.bind(this, ipAddress, systemID))
        } catch (error) {
            return []
        }
    }

    private _mapDevice(ipAddress: string, systemID: string, thermostat: Thermostat): any {
        return {
            name: thermostat.name,
            data: {
                id: `${systemID}_${thermostat.id}`,
                controllerID: thermostat.controllerID,
                thermostatID: thermostat.thermostatID,
            },
            store: {
                address: ipAddress,
            }
        }
    }
}

module.exports = UponorDriver
