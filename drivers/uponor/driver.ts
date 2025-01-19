import { Driver } from 'homey'
import { Thermostat, UponorHTTPClient } from '../../lib/UponorHTTPClient'
import { PairSession } from 'homey/lib/Driver'
import {
    IP_ADDRESS_SETTINGS_KEY,
    CUSTOM_IP_ADDRESS_SETTINGS_KEY,
    DEBUG_DEVICES_SETTINGS_KEY,
    LIST_DEVICES_PAIR_KEY,
    CUSTOM_IP_ADDRESS_PAIR_KEY,
} from '../../lib/constants'

export class UponorDriver extends Driver {

    private _client?: UponorHTTPClient

    getClient(address: string | null = null): UponorHTTPClient {
        address = address || this.getIpAddress()
        if (!address) throw new Error('IP address not discovered or set during pairing')
        if (!this._client) this._client = new UponorHTTPClient(address)
        return this._client
    }

    getIpAddress(): string {
        const address = this.getCustomIpAddress() || this.homey.settings.get(IP_ADDRESS_SETTINGS_KEY)
        if (!address) throw new Error('IP address not discovered or set during pairing')
        return address
    }

    async setIpAddress(address: string): Promise<boolean> {
        this.homey.settings.set(IP_ADDRESS_SETTINGS_KEY, address)
        return await this.getClient(address).updateAddress(address)
    }

    getCustomIpAddress(): string {
        return this.homey.settings.get(CUSTOM_IP_ADDRESS_SETTINGS_KEY)
    }

    private async _setCustomIpAddress(address: string): Promise<void> {
        return this.homey.settings.set(CUSTOM_IP_ADDRESS_SETTINGS_KEY, address)
    }

    async onPair(session: PairSession): Promise<void> {
        this.homey.settings.unset(CUSTOM_IP_ADDRESS_SETTINGS_KEY)
        session.setHandler(CUSTOM_IP_ADDRESS_PAIR_KEY, this._setCustomIpAddress.bind(this))
        session.setHandler(LIST_DEVICES_PAIR_KEY, this._listDevices.bind(this))
    }

    private async _listDevices(): Promise<any[]> {
        // when a custom IP address is set, only return devices for that address
        const custom_address = this.getCustomIpAddress()
        if (custom_address) return await this._findDevices(custom_address, `custom_${new Date().getTime()}`)

        // otherwise discover devices on the network and use the first one found
        const discoveryStrategy = this.getDiscoveryStrategy()
        const discoveryResults = discoveryStrategy.getDiscoveryResults()
        const controller = Object.values(discoveryResults).pop()
        if (!controller) return []

        this.setIpAddress(controller.address)
        return await this._findDevices(controller.address, controller.id)
    }

    private async _findDevices(address: string, systemID: string): Promise<any[]> {
        try {
            const success = await this.getClient(address).updateAddress(address)
            if (!success) throw new Error(`Could not connect to Uponor controller at IP address ${address}`)
            await this.getClient().syncAttributes()
            const debug = await this.getClient().debug()
            this.homey.settings.set(DEBUG_DEVICES_SETTINGS_KEY, JSON.stringify(debug))
            const thermostats = Array.from(this.getClient().getThermostats().values())
            return thermostats.map(this._mapDevice.bind(this, address, systemID))
        } catch (error) {
            this.homey.error(error)
            return []
        }
    }

    private _mapDevice(address: string, systemID: string, thermostat: Thermostat): any {
        return {
            name: thermostat.name,
            data: {
                id: `${systemID}_${thermostat.id}`,
                controllerID: thermostat.controllerID,
                thermostatID: thermostat.thermostatID,
            },
            store: {
                address: address,
            }
        }
    }
}

module.exports = UponorDriver
