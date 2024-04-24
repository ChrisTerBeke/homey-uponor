import { Device } from 'homey'
import { UponorHTTPClient } from '../../lib/UponorHTTPClient'
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
        const { ip_address, controller_id, thermostat_id } = this.getData()
        this._client = new UponorHTTPClient(ip_address)
        this._syncInterval = setInterval(this._syncAttributes.bind(this, controller_id, thermostat_id), POLL_INTERVAL_MS)
        await this._syncAttributes(controller_id, thermostat_id)
    }

    async onDeleted(): Promise<void> {
        clearInterval(this._syncInterval as NodeJS.Timeout)
        this._syncInterval = undefined
        this._client = undefined
    }

    private async _syncAttributes(controller_id: number, thermostat_id: number) {
        await this._client?.syncAttributes()
        const data = this._client?.getThermostat(controller_id, thermostat_id)

        this.setCapabilityValue('measure_temperature', data?.temperature)
        // this.setCapabilityValue('target_temperature', data?.setPoint)
        // this.setCapabilityValue('thermostat_mode', 'auto')
    }
}

module.exports = UponorThermostatDevice
