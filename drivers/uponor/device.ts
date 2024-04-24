import { Device } from 'homey'
import { UponorHTTPClient, Mode } from '../../lib/UponorHTTPClient'
// import { DiscoveryResultMAC } from 'homey/lib/DiscoveryStrategy'

// sync thermostat every minute
const POLL_INTERVAL_MS = 1000 * 60 * 1

class UponorThermostatDevice extends Device {

    private _syncInterval?: NodeJS.Timer
    private _client?: UponorHTTPClient

    // onDiscoveryResult(discoveryResult: DiscoveryResultMAC) {
    //     return discoveryResult.id === this.getData().id
    // }

    async onInit() {
        const { IPAddress } = this.getData()
        this._client = new UponorHTTPClient(IPAddress)
        this._syncInterval = setInterval(this._syncAttributes.bind(this), POLL_INTERVAL_MS)
        this.registerCapabilityListener('target_temperature', this._setTargetTemperature.bind(this))
        // this.registerCapabilityListener('thermostat_mode', this._setThermostatMode.bind(this))
        await this._syncAttributes()
    }

    async onDeleted(): Promise<void> {
        clearInterval(this._syncInterval as NodeJS.Timeout)
        this._syncInterval = undefined
        this._client = undefined
    }

    private async _syncAttributes() {
        await this._client?.syncAttributes()
        const { controllerID, thermostatID } = this.getData()
        const data = this._client?.getThermostat(controllerID, thermostatID)
        this.setCapabilityValue('measure_temperature', data?.temperature)
        this.setCapabilityValue('target_temperature', data?.setPoint)
        // this.setCapabilityValue('thermostat_mode', data?.mode)
    }

    private async _setTargetTemperature(value: number) {
        const { controllerID, thermostatID } = this.getData()
        await this._client?.setTargetTemperature(controllerID, thermostatID, value)
        await this._syncAttributes()
    }

    private async _setThermostatMode(value: Mode) {
        const { controllerID, thermostatID } = this.getData()
        await this._client?.setMode(controllerID, thermostatID, value)
        await this._syncAttributes()
    }
}

module.exports = UponorThermostatDevice
