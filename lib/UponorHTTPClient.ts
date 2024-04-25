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
    private _attributes: Map<string, string> = new Map()
    private _thermostats: Map<string, Thermostat> = new Map()

    constructor(ip_address: string) {
        this._url = `http://${ip_address}/JNAP/`
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
        this._attributes = await this._syncAttributes()
        this._thermostats = this._syncThermostats()
    }

    public async testConnection(): Promise<boolean> {
        const request = await fetch(this._url, {
            method: 'POST',
            headers: { 'x-jnap-action': 'http://phyn.com/jnap/uponorsky/GetAttributes' },
            body: '{}'
        })
        return request.status == 200
    }

    private async _syncAttributes(): Promise<Map<string, string>> {
        const request = await fetch(this._url, {
            method: 'POST',
            headers: { 'x-jnap-action': 'http://phyn.com/jnap/uponorsky/GetAttributes' },
            body: '{}'
        })
        const data: AttributesResponse = await request.json() as AttributesResponse
        if (data.result != 'OK') {
            return Promise.reject(data.result)
        }

        const result = new Map<string, string>()
        for (const v of data.output.vars) {
            result.set(v.waspVarName, v.waspVarValue)
        }

        return result
    }

    private _syncThermostats(): Map<string, Thermostat> {
        const attributes = this.getAttributes()
        const thermostats: Map<string, Thermostat> = new Map()

        attributes.forEach((value, key) => {
            const regex = /cust_C(\d+)_T(\d+)_name/
            const matches = regex.exec(key)
            if (!matches) return
            const controllerID = matches[1] // first capture group
            const thermostatID = matches[2] // second capture group
            const ctKey = UponorHTTPClient._createKey(controllerID, thermostatID)

            // TODO: calculate actual mode using heat/cool/eco/holiday/comfort mode attributes
            // C2_T6_cool_allowed = "0"
            // C2_T6_manual_cool_allowed = "0"
            // C2_T6_heat_cool_mode = "0"
            // C1_T1_heat_cool_slave = "0"
            // C2_T6_stat_cb_comfort_eco_mode = "0"
            // C1_T1_mode_comfort_eco = "0"
            // C2_T6_stat_cb_eco_forced = "0"
            // C1_T1_eco_profile_number = "0"
            // C2_T6_stat_cb_holiday_mode = "0"
            // C2_T6_stat_cb_heat_cool_mode = "0"
            // C2_T6_stat_comfort_eco_mode = "0"
            // C2_T6_stat_eco_program = "0"
            // C2_T6_eco_setting = "0"
            // C1_T1_eco_offset = "72"

            // TODO: implement alarms
            // C2_T6_stat_cb_fallbk_heatalarm = "0"
            // C2_T6_stat_air_sensor_error = "0"
            // C2_T6_stat_external_sensor_err = "0"
            // C2_T6_stat_rh_sensor_error = "0"
            // C2_T6_stat_tamper_alarm = "0"
            // C2_T6_stat_rf_error = "0"
            // C2_T6_stat_battery_error = "0"
            // C2_T6_stat_rf_low_sig_warning = "0"
            // C2_T6_stat_valve_position_err = "0"

            // TODO: other
            // C1_T1_head1_supply_temp = "54"
            // C1_T1_head1_valve_pos_percent = "0"
            // C1_T1_head1_valve_pos = "0"
            // C1_T1_head2_valve_pos_percent = "0"
            // C1_T1_head2_valve_pos = "0"
            // C1_T1_head2_supply_temp = "0"
            // C1_T1_channel_position = "7"
            // C1_T1_head_number = "0"
            // C1_T1_bypass_enable = "0"

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

        return thermostats
    }

    public async setTargetTemperature(controllerID: number, thermostatID: number, value: number): Promise<void> {
        const fahrenheit = (value * 9 / 5) + 32
        const setPoint = round(fahrenheit * 10, 0).toString()
        await this._setAttributes(new Map([[`C${controllerID}_T${thermostatID}_setpoint`, setPoint]]))
    }

    public async setMode(controllerID: number, thermostatID: number, value: Mode): Promise<void> {
        // TODO: convert value to correct heat/cool/eco/holiday/comfort attributes
        // await this._setAttribute("", "")
    }

    private async _setAttributes(attributes: Map<string, string>): Promise<void> {
        const vars = Array.from(attributes, ([key, value]) => [{ "waspVarName": key, "waspVarValue": value }]).flat()
        const request = await fetch(this._url, {
            method: 'POST',
            headers: { 'x-jnap-action': 'http://phyn.com/jnap/uponorsky/SetAttributes' },
            body: JSON.stringify({ "vars": vars }),
        })
        const data: AttributesResponse = await request.json() as AttributesResponse
        if (data.result != 'OK') {
            return Promise.reject(data.result)
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
