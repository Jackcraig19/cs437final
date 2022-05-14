const bleno = require('@abandonware/bleno')

const HOOP_SERVICE_ID = '00001818-000a-1000-8000-00805f9b34fc'
const HOOP_CHAR_COLOR_ID = '00001818-000a-1000-8000-00805f9b34fa'
const HOOP_CHAR_ACTIVE_ID = '00001818-000a-1000-8000-00805f9b34fd'
const HOOP_CHAR_SCORE_ID = '00001818-000a-1000-8000-00805f9b34fb'
const THIS_HOOP_COLOR = '01'

process.stdin.setRawMode(true)
process.stdin.setEncoding('utf8')

const BlenoPrimaryService = bleno.PrimaryService
const BlenoCharacteristic = bleno.Characteristic;

const SCORE_BUFFER = Buffer.from('01', 'hex')

const scoreChar = new BlenoCharacteristic({
    uuid: HOOP_CHAR_SCORE_ID,
    properties: ['read', 'notify'],
    onWriteRequest: (data, off, woR, cb) => {
        console.log('Score Char Write: ' + data.toString('hex'))
    },
    onSubscribe: (maxValSize, updateCb) => {
        console.log('Sending Score Event')
        process.stdin.on('data', () => updateCb(SCORE_BUFFER))
    }
})

const colorChar = new BlenoCharacteristic({
    uuid: HOOP_CHAR_COLOR_ID,
    properties: ['read'],
    onReadRequest: (off, cb) => {
        console.log('Color Char Read: ' + off)   
        const data = Buffer.from(THIS_HOOP_COLOR, 'hex')
        cb(BlenoCharacteristic.RESULT_SUCCESS, data)
    }
})

const activeChar = new BlenoCharacteristic({
    uuid: HOOP_CHAR_ACTIVE_ID,
    properties: ['read', 'write', 'notify'],
    onReadRequest: (off, cb) => {
        console.log('Active Char Read')
    },
    onWriteRequest: (data, off, woR, cb) => {
        console.log('Active Char Write: ' + data.toString('hex'))
    },
})

const hoopService = new BlenoPrimaryService({
    uuid: HOOP_SERVICE_ID,
    characteristics: [
        scoreChar,
        colorChar,
        activeChar
    ]
})

bleno.on('stateChange', state => {
    if (state === 'poweredOn') {
        bleno.startAdvertising('Test Periph', [HOOP_SERVICE_ID])
        console.log('Advertising Start Emit')
    } else {
        bleno.stopAdvertising()
        console.log('Advertising Stop: ' + state)
    }
})

bleno.on('advertisingStart', err => {
    console.log('Advertising Start Rec')
    if (err)
        return console.error(err)
    bleno.setServices([hoopService])
})

bleno.on('accept', addr => {
    console.log('Accepted ' + addr)
})