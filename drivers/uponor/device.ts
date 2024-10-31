import { isIPv4 } from 'net'
import { Device, DiscoveryResultMAC } from 'homey'
import { UponorHTTPClient } from '../../lib/UponorHTTPClient'

const POLL_INTERVAL_MS = 1000 * 60 * 1

class UponorThermostatDevice extends Device {

    private _syncInterval?: NodeJS.Timer
    private _client?: UponorHTTPClient

    async onInit(): Promise<void> {
        this._init()
    }

    async onAdded(): Promise<void> {
        this._init()
    }

    async onUninit(): Promise<void> {
        this._uninit()
    }

    onDiscoveryResult(discoveryResult: DiscoveryResultMAC): boolean {
        return this.getData().id.includes(discoveryResult.id)
    }

    async onDiscoveryAvailable(discoveryResult: DiscoveryResultMAC): Promise<void> {
        await this.setSettings({ 'discovered_address': discoveryResult.address })
        this._updateAddress(discoveryResult.address, true)
    }

    async onDiscoveryAddressChanged(discoveryResult: DiscoveryResultMAC): Promise<void> {
        await this.setSettings({ 'discovered_address': discoveryResult.address })
        this._updateAddress(discoveryResult.address, true)
    }

    async onSettings({ newSettings }: { newSettings: { [key: string]: any } }): Promise<void> {
        const addressUpdated = await this._updateAddress(newSettings.address as string)
        if (!addressUpdated) throw new Error(`Could not connect to Uponor controller on IP address ${newSettings.address}`)
    }

    private _getAddress(): string | undefined {
        const settingAddress = this.getSetting('address')
        if (settingAddress && isIPv4(settingAddress)) return settingAddress
        const storeAddress = this.getStoreValue('address')
        if (storeAddress && isIPv4(storeAddress)) return storeAddress
        return undefined
    }

    private async _updateAddress(newAddress: string, persist = false): Promise<boolean> {
        if (newAddress.length === 0) {
            newAddress = await this.getStoreValue('address')
        }

        if (!isIPv4(newAddress)) {
            return false
        }

        if (persist) {
            await this.setStoreValue('address', newAddress)
        }

        if (!this._client) return false
        const success = await this._client.updateAddress(newAddress)
        return success
    }

    async _init(): Promise<void> {
        // TODO: implement dynamic capability system like the Remeha app
        this.registerCapabilityListener('target_temperature', this._setTargetTemperature.bind(this))

        const address = this._getAddress()
        if (!address) return this.setUnavailable('No IP address configured')

        try {
            const client = new UponorHTTPClient(address)
            const canConnect = await client.testConnection()
            if (!canConnect) return this.setUnavailable(`Could not connect to Uponor controller on IP address ${address}`)
            this._client = client
            this._syncInterval = setInterval(this._syncAttributes.bind(this), POLL_INTERVAL_MS)
            setTimeout(this._syncAttributes.bind(this), 2000)
        } catch (error) {
            this.setUnavailable(`Error connecting to Uponor controller: ${error}`)
        }
    }

    async _uninit(): Promise<void> {
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

        try {
            const { debugEnabled } = this.getSettings()
            if (!debugEnabled) return
            const debug = await this._client.debug()
            this.setSettings({ apiData: JSON.stringify(debug) })
        } catch (error) { }
    }

    private async _setTargetTemperature(value: number): Promise<void> {
        if (!this._client) return this.setUnavailable('No Uponor client')
        const { controllerID, thermostatID } = this.getData()

        try {
            await this._client.setTargetTemperature(controllerID, thermostatID, value)
        } catch (error) {
            this.setUnavailable('Could not send data to Uponor controller')
        }
    }
}

module.exports = UponorThermostatDevice
