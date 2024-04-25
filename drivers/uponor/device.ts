import { Device, DiscoveryResult } from 'homey'
import { UponorHTTPClient, Mode } from '../../lib/UponorHTTPClient'
import { DiscoveryResultMAC } from 'homey/lib/DiscoveryStrategy'

// sync thermostat every minute
const POLL_INTERVAL_MS = 1000 * 60 * 1

class UponorThermostatDevice extends Device {

    private _syncInterval?: NodeJS.Timer
    private _client?: UponorHTTPClient

    async onInit(): Promise<void> {
        this.registerCapabilityListener('target_temperature', this._setTargetTemperature.bind(this))
        // this.registerCapabilityListener('thermostat_mode', this._setThermostatMode.bind(this))
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

    async onDiscoveryAvailable(discoveryResult: DiscoveryResultMAC): Promise<void> {
        this._updateAddress(discoveryResult.address)
    }

    async onDiscoveryAddressChanged(discoveryResult: DiscoveryResultMAC): Promise<void> {
        this._updateAddress(discoveryResult.address)
    }

    async onDiscoveryLastSeenChanged(discoveryResult: DiscoveryResultMAC): Promise<void> {
        this._updateAddress(discoveryResult.address)
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
        const client = new UponorHTTPClient(newAddress)
        const canConnect = await client.testConnection()
        if (!canConnect) return false
        this.setStoreValue('address', newAddress)
        this._init()
        return true
    }

    async _init(): Promise<void> {
        await this._uninit()
        const address = this._getAddress()
        if (!address) return this.setUnavailable('No IP address configured')
        const client = new UponorHTTPClient(address)
        const canConnect = await client.testConnection()
        if (!canConnect) return this.setUnavailable(`Could not connect to Uponor controller on IP address ${address}`)
        this._client = client
        this._syncInterval = setInterval(this._syncAttributes.bind(this), POLL_INTERVAL_MS)
        this._syncAttributes()
    }

    async _uninit(): Promise<void> {
        this.setUnavailable()
        clearInterval(this._syncInterval as NodeJS.Timeout)
        this._syncInterval = undefined
        this._client = undefined
    }

    private async _syncAttributes(): Promise<void> {
        if (!this._client) return this.setUnavailable('No Uponor client')
        await this._client.syncAttributes()
        const { controllerID, thermostatID } = this.getData()
        const data = this._client.getThermostat(controllerID, thermostatID)
        if (!data) return this.setUnavailable('Could not find thermostat data')
        this.setAvailable()
        this.setCapabilityValue('measure_temperature', data.temperature)
        this.setCapabilityValue('target_temperature', data.setPoint)
        // this.setCapabilityValue('thermostat_mode', data.mode)
    }

    private async _setTargetTemperature(value: number): Promise<void> {
        if (!this._client) return
        const { controllerID, thermostatID } = this.getData()
        await this._client.setTargetTemperature(controllerID, thermostatID, value)
        await this._syncAttributes()
    }

    private async _setThermostatMode(value: Mode): Promise<void> {
        if (!this._client) return
        const { controllerID, thermostatID } = this.getData()
        await this._client.setMode(controllerID, thermostatID, value)
        await this._syncAttributes()
    }
}

module.exports = UponorThermostatDevice
