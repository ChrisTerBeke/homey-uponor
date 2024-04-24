import { Device, DiscoveryResult } from 'homey'
import { UponorHTTPClient, Mode } from '../../lib/UponorHTTPClient'
import { DiscoveryResultMAC } from 'homey/lib/DiscoveryStrategy'

// sync thermostat every minute
const POLL_INTERVAL_MS = 1000 * 60 * 1

class UponorThermostatDevice extends Device {

    private _syncInterval?: NodeJS.Timer
    private _client?: UponorHTTPClient
    
    async onInit() {
        this.registerCapabilityListener('target_temperature', this._setTargetTemperature.bind(this))
        // this.registerCapabilityListener('thermostat_mode', this._setThermostatMode.bind(this))
        this._syncInterval = setInterval(this._syncAttributes.bind(this), POLL_INTERVAL_MS)
    }

    onDiscoveryResult(discoveryResult: DiscoveryResult) {
        return this.getData().id.includes(discoveryResult.id)
    }

    async onDiscoveryAddressChanged(discoveryResult: DiscoveryResultMAC): Promise<void> {
        this._client = new UponorHTTPClient(discoveryResult.address)
        await this._syncAttributes()
    }

    async onDiscoveryAvailable(discoveryResult: DiscoveryResultMAC) {
        this._client = new UponorHTTPClient(discoveryResult.address)
        await this._syncAttributes()
    }

    async onDeleted(): Promise<void> {
        clearInterval(this._syncInterval as NodeJS.Timeout)
        this._syncInterval = undefined
        this._client = undefined
    }

    private async _syncAttributes() {
        if (!this._client) return
        await this._client.syncAttributes()
        const { controllerID, thermostatID } = this.getData()
        const data = this._client.getThermostat(controllerID, thermostatID)
        if (!data) return
        this.setCapabilityValue('measure_temperature', data.temperature)
        this.setCapabilityValue('target_temperature', data.setPoint)
        // this.setCapabilityValue('thermostat_mode', data?.mode)
    }

    private async _setTargetTemperature(value: number) {
        if (!this._client) return
        const { controllerID, thermostatID } = this.getData()
        await this._client.setTargetTemperature(controllerID, thermostatID, value)
        await this._syncAttributes()
    }

    private async _setThermostatMode(value: Mode) {
        if (!this._client) return
        const { controllerID, thermostatID } = this.getData()
        await this._client.setMode(controllerID, thermostatID, value)
        await this._syncAttributes()
    }
}

module.exports = UponorThermostatDevice
