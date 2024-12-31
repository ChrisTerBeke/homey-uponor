import { Device, DiscoveryResultMAC } from 'homey'
import { UponorHTTPClient } from '../../lib/UponorHTTPClient'
import { UponorDriver } from './driver'

const POLL_INTERVAL_MS = 1000 * 60 * 1

class UponorThermostatDevice extends Device {

    async onInit(): Promise<void> {
        this.homey.setInterval(this._sync.bind(this), POLL_INTERVAL_MS)
        this.homey.setTimeout(this._sync.bind(this), 2000)
    }

    onDiscoveryResult(discoveryResult: DiscoveryResultMAC): boolean {
        return this.getData().id.includes(discoveryResult.id)
    }

    async onDiscoveryAvailable(discoveryResult: DiscoveryResultMAC): Promise<void> {
        await this._updateAddress(discoveryResult.address)
    }

    async onDiscoveryAddressChanged(discoveryResult: DiscoveryResultMAC): Promise<void> {
        await this._updateAddress(discoveryResult.address)
    }

    private _getClient(): UponorHTTPClient {
        const driver = this.driver as UponorDriver
        return driver.getClient()
    }

    private async _updateAddress(newAddress: string): Promise<boolean> {
        const driver = this.driver as UponorDriver
        return await driver.setIpAddress(newAddress)
    }

    private async _sync(): Promise<void> {
        await this._syncCapabilities()
        await this._syncAttributes()
    }

    private async _syncCapabilities(): Promise<void> {
        this._ensureCapabilityListener('target_temperature', this._setTargetTemperature.bind(this))
    }

    private _ensureCapabilityListener(capability: string, callback: (value: any) => Promise<void>): void {
        if (this.listenerCount(capability) === 1) return
        this.registerCapabilityListener(capability, callback)
    }

    private async _syncAttributes(): Promise<void> {
        try {
            await this._getClient().syncAttributes()
            const { controllerID, thermostatID } = this.getData()
            const data = this._getClient().getThermostat(controllerID, thermostatID)
            if (!data) return this.setUnavailable('Could not find thermostat data')
            this.setAvailable()
            this.setCapabilityValue('measure_temperature', data.temperature)
            this.setCapabilityValue('target_temperature', data.setPoint)
        } catch (error) {
            this.setUnavailable('Could not fetch data from Uponor controller')
        }
    }

    private async _setTargetTemperature(value: number): Promise<void> {
        const { controllerID, thermostatID } = this.getData()
        try {
            await this._getClient().setTargetTemperature(controllerID, thermostatID, value)
        } catch (error) {
            this.setUnavailable('Could not send data to Uponor controller')
        }
    }
}

module.exports = UponorThermostatDevice
