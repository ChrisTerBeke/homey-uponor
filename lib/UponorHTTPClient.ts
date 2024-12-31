import { isIPv4 } from 'net'
import fetch from 'node-fetch'

export type Mode = 'auto' | 'heat' | 'cool' | 'off'

export type Thermostat = {
    id: string | undefined
    controllerID: number | undefined
    thermostatID: number | undefined
    name: string | undefined
    temperature: number | undefined
    setPoint: number | undefined
    minimumSetPoint: number | undefined
    maximumSetPoint: number | undefined
    mode: Mode | undefined
}

type AttributesResponse = {
    result: string
    output: {
        vars: {
            waspVarName: string
            waspVarValue: string
        }[]
    }
}

export class UponorHTTPClient {

    private _url: string
    private _lastSync: Date | undefined
    private _rawAttributes: any
    private _attributes: Map<string, string> = new Map()
    private _thermostats: Map<string, Thermostat> = new Map()

    constructor(ip_address: string) {
        this._url = `http://${ip_address}/JNAP/`
    }

    public async updateAddress(newAddress: string): Promise<boolean> {
        if (!isIPv4(newAddress)) return false
        this._url = `http://${newAddress}/JNAP/`
        return await this.testConnection()
    }

    public getAttributes(): Map<string, string> {
        return this._attributes
    }

    public getAttribute(name: string): string | undefined {
        return this._attributes.get(name)
    }

    public getThermostats(): Map<string, Thermostat> {
        return this._thermostats
    }

    public getThermostat(controllerID: number, thermostatID: number): Thermostat | undefined {
        const ctKey = UponorHTTPClient._createKey(controllerID, thermostatID)
        return this._thermostats.get(ctKey)
    }

    public async syncAttributes(): Promise<void> {
        await this._syncRawAttributes()
        await this._parseAttributes()
        await this._syncThermostats()
    }

    public async debug(): Promise<any> {
        return this._rawAttributes
    }

    public async testConnection(): Promise<boolean> {
        return this._syncRawAttributes(true)
    }

    public async setTargetTemperature(controllerID: number, thermostatID: number, value: number): Promise<void> {
        const fahrenheit = (value * 9 / 5) + 32
        const setPoint = round(fahrenheit * 10, 0).toString()
        await this._setAttributes(new Map([[`C${controllerID}_T${thermostatID}_setpoint`, setPoint]]))
    }

    // public async setMode(controllerID: number, thermostatID: number, value: Mode): Promise<void> {
    //     // TODO: convert value to correct heat/cool/eco/holiday/comfort attributes
    //     // await this._setAttribute("", "")
    // }

    private async _syncRawAttributes(force: boolean = false): Promise<boolean> {
        if (!force && this._lastSync && (new Date().getTime() - this._lastSync.getTime()) < 60000) {
            return true
        }

        try {
            const request = await fetch(this._url, {
                method: 'POST',
                headers: { 'x-jnap-action': 'http://phyn.com/jnap/uponorsky/GetAttributes' },
                body: '{}'
            })
            this._lastSync = new Date()
            this._rawAttributes = await request.json()
            return request.status == 200
        } catch (error) {
            return false
        }
    }

    private async _parseAttributes(): Promise<Map<string, string>> {
        const data = this._rawAttributes as AttributesResponse
        if (data.result != 'OK') return Promise.reject(data.result)
        return new Map(data.output.vars.map(v => [v.waspVarName, v.waspVarValue]))
    }

    private async _syncThermostats(): Promise<void> {
        const attributes = this.getAttributes()
        const thermostats: Map<string, Thermostat> = new Map()

        attributes.forEach((value, key) => {
            const regex = /cust_C(\d+)_T(\d+)_name/
            const matches = regex.exec(key)
            if (!matches) return
            const controllerID = matches[1] // first capture group
            const thermostatID = matches[2] // second capture group
            const ctKey = UponorHTTPClient._createKey(controllerID, thermostatID)

            thermostats.set(ctKey, {
                id: ctKey,
                name: value,
                controllerID: parseInt(controllerID),
                thermostatID: parseInt(thermostatID),
                temperature: UponorHTTPClient._formatTemperature(this.getAttribute(`${ctKey}_room_temperature`)),
                setPoint: UponorHTTPClient._formatTemperature(this.getAttribute(`${ctKey}_setpoint`)),
                minimumSetPoint: UponorHTTPClient._formatTemperature(this.getAttribute(`${ctKey}_minimum_setpoint`)),
                maximumSetPoint: UponorHTTPClient._formatTemperature(this.getAttribute(`${ctKey}_maximum_setpoint`)),
                mode: 'auto',
            })
        })

        this._thermostats = thermostats
    }

    private async _setAttributes(attributes: Map<string, string>): Promise<void> {
        try {
            const vars = Array.from(attributes, ([key, value]) => [{ "waspVarName": key, "waspVarValue": value }]).flat()
            const request = await fetch(this._url, {
                method: 'POST',
                headers: { 'x-jnap-action': 'http://phyn.com/jnap/uponorsky/SetAttributes' },
                body: JSON.stringify({ "vars": vars }),
            })
            const data: AttributesResponse = await request.json() as AttributesResponse
            if (data.result != 'OK') return Promise.reject(data.result)
        } catch (error) {
            return Promise.reject(error)
        }
    }

    private static _formatTemperature(input: string | undefined): number {
        const fahrenheit = parseFloat(input || '0') / 10
        const celcius = (fahrenheit - 32) * 5 / 9
        return round(celcius, 1)
    }

    private static _createKey(controllerID: string | number, thermostatID: string | number): string {
        return `C${controllerID}_T${thermostatID}`
    }
}

function round(value: number, precision: number = 0): number {
    var multiplier = Math.pow(10, precision)
    return Math.round(value * multiplier) / multiplier
}
