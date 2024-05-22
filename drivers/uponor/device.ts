import { isIPv4 } from 'net'
import { Device, DiscoveryResult } from 'homey'
import { UponorHTTPClient } from '../../lib/UponorHTTPClient'

const POLL_INTERVAL_MS = 1000 * 60 * 1

class UponorThermostatDevice extends Device {

    private _syncInterval?: NodeJS.Timer
    private _client?: UponorHTTPClient

    async onInit(): Promise<void> {
        this.registerCapabilityListener('target_temperature', this._setTargetTemperature.bind(this))
        this._init()
    }

    async onAdded(): Promise<void> {
        this._init()
    }

    async onUninit(): Promise<void> {
        this._uninit()
    }

    onDiscoveryResult(discoveryResult: DiscoveryResult): boolean {
        return this.getData().id.includes(discoveryResult.id)
    }

    async onDiscoveryAvailable(discoveryResult: DiscoveryResult): Promise<void> {
        this._updateAddress(discoveryResult.id)
    }

    async onDiscoveryAddressChanged(discoveryResult: DiscoveryResult): Promise<void> {
        this._updateAddress(discoveryResult.id)
    }

    async onDiscoveryLastSeenChanged(discoveryResult: DiscoveryResult): Promise<void> {
        this._updateAddress(discoveryResult.id)
    }

    async onSettings({ newSettings }: { newSettings: { [key: string]: any } }): Promise<void> {
        const addressUpdated = await this._updateAddress(newSettings.address as string)
        if (!addressUpdated) {
            throw new Error(`Could not connect to Uponor controller on IP address ${newSettings.address}`)
        }
    }

    async onDeleted(): Promise<void> {
        this._uninit()
    }

    private _getAddress(): string | undefined {
        const settingAddress = this.getSetting('address')
        if (settingAddress) return settingAddress
        const storeAddress = this.getStoreValue('address')
        if (storeAddress) return storeAddress
        return undefined
    }

    private async _updateAddress(newAddress: string): Promise<boolean> {
        if (newAddress.length > 0) {
            const isValidIP = isIPv4(newAddress)
            if (!isValidIP) return false
            const client = new UponorHTTPClient(newAddress)
            try {
                const canConnect = await client.testConnection()
                if (!canConnect) return false
            } catch (error) {
                return false
            }
        }
        this.setStoreValue('address', newAddress)
        this._init()
        return true
    }

    async _init(): Promise<void> {
        await this._uninit()
        const address = this._getAddress()
        if (!address) return this.setUnavailable('No IP address configured')

        try {
            const client = new UponorHTTPClient(address)
            const canConnect = await client.testConnection()
            if (!canConnect) return this.setUnavailable(`Could not connect to Uponor controller on IP address ${address}`)
            this._client = client
            this._syncInterval = setInterval(this._syncAttributes.bind(this), POLL_INTERVAL_MS)
            this._syncAttributes()
        } catch (error) {
            this.setUnavailable(`Could not connect to Uponor controller on IP address ${address}`)
        }
    }

    async _uninit(): Promise<void> {
        this.setUnavailable()
        clearInterval(this._syncInterval as NodeJS.Timeout)
        this._syncInterval = undefined
        this._client = undefined
    }

    private async _syncAttributes(): Promise<void> {
        if (!this._client) return this.setUnavailable('No Uponor client')

        try {
            await this._client.syncAttributes()
            const { controllerID, thermostatID } = this.getData()
            const data = this._client.getThermostat(controllerID, thermostatID)
            if (!data) return this.setUnavailable('Could not find thermostat data')
            this.setAvailable()
            this.setCapabilityValue('measure_temperature', data.temperature)
            this.setCapabilityValue('target_temperature', data.setPoint)
        } catch (error) {
            this.setUnavailable('Could not fetch data from Uponor controller')
        }
    }

    private async _setTargetTemperature(value: number): Promise<void> {
        if (!this._client) return

        try {
            const { controllerID, thermostatID } = this.getData()
            await this._client.setTargetTemperature(controllerID, thermostatID, value)
        } catch (error) {
            this.setUnavailable('Could not send data to Uponor controller')
        }

        await this._syncAttributes()
    }
}

module.exports = UponorThermostatDevice
