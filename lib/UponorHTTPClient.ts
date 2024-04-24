import fetch from 'node-fetch'

export type Thermostat = {
    id: string | undefined
    controller_id: number | undefined
    thermostat_id: number | undefined
    name: string | undefined
    temperature: number | undefined
    setPoint: number | undefined
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

    constructor(ip_address: string) {
        this._url = `http://${ip_address}/JNAP/`
    }

    public getAttributes(): Map<string, string> {
        return this._attributes
    }

    public getAttribute(name: string): string | undefined {
        return this._attributes.get(name)
    }

    public getThermostats(): Thermostat[] {
        const attributes = this.getAttributes()
        const thermostats: Thermostat[] = []

        // TODO: only do this once on init
        attributes.forEach((value, key) => {

            const regex = /cust_C(\d+)_T(\d+)_name/
            const matches = regex.exec(key)
            if (!matches) {
                return
            }

            const controller_id = matches[1] // first capture group
            const thermostat_id = matches[2] // second capture group
            const ctKey = `C${controller_id}_T${thermostat_id}`

            thermostats.push({
                id: ctKey,
                name: value,
                controller_id: parseInt(controller_id),
                thermostat_id: parseInt(thermostat_id),
                temperature: this._formatTemperature(this.getAttribute(`${ctKey}_room_temperature`)),
                setPoint: this._formatTemperature(this.getAttribute(`${ctKey}_setpoint`)),
            })
        })

        return thermostats
    }

    public getThermostat(controller_id: number, thermostat_id: number): Thermostat {
        const ctKey = `C${controller_id}_T${thermostat_id}`
        return {
            id: ctKey,
            name: this.getAttribute(`cust_${ctKey}_name`),
            controller_id: controller_id,
            thermostat_id: thermostat_id,
            temperature: this._formatTemperature(this.getAttribute(`${ctKey}_room_temperature`)),
            setPoint: this._formatTemperature(this.getAttribute(`${ctKey}_setpoint`)),
        }
    }

    public async syncAttributes(): Promise<void> {
        this._attributes = await this._getAllAttributes()
    }

    private _formatTemperature(input: string | undefined): number {
        const fahrenheit = parseFloat(input || '0') / 10
        return Math.round((fahrenheit - 32) * 5 / 9)
    }

    private async _getAllAttributes(): Promise<Map<string, string>> {
        const request = await fetch(this._url, {
            method: 'POST',
            headers: {
                'x-jnap-action': 'http://phyn.com/jnap/uponorsky/GetAttributes'
            },
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

    private async _setAttributes() {
        //     def send_data(self, data):
        // items = []
        // for k, v in data.items():
        //     items.append('{'waspVarName': '' + k + '','waspVarValue': '' + str(v) + ''}')
        // payload = '{'vars': [' + ','.join(items) + ']}'

        // r = requests.post(url = self.url, headers = { 'x-jnap-action': 'http://phyn.com/jnap/uponorsky/SetAttributes' },
        //     data = payload)
        // r_json = r.json()

        // if 'result' in r_json and not r_json['result'] == 'OK':
        //             raise ValueError(r_json)
    }
}
