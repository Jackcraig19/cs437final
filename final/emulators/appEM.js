const noble = require('@abandonware/noble')

const HOOP_SERVICE_UUID = "00001818-000a-1000-8000-00805f9b34fc"
const HOOP_CHARACTERISTIC_UUID = "00001818-000a-1000-8000-00805f9b34fd"

noble.on('stateChange', function (state) {
    if (state === 'poweredOn') {
        console.log('Powerd On!')
        noble.startScanning([HOOP_SERVICE_UUID]);
    } else {
        console.log('Powerd Off.')
        noble.stopScanning();
    }
});

noble.on('scanStart', async () => {
    console.log("Scanning Started.")
})

noble.on('discover', async (peripheral) => {
    await peripheral.connectAsync()
    peripheral.discoverSomeServicesAndCharacteristics([HOOP_SERVICE_UUID], [HOOP_CHARACTERISTIC_UUID], async (err, services, characteristics) => {
        if (err) {
            console.log('Error discovering hoop services.')
        }
        console.log('Discovered hoop service.')
        
        const hoopCharacteristic = characteristics[0]
        
        await hoopCharacteristic.subscribeAsync()

        hoopCharacteristic.on('data', (data, isNotif) => {
            console.log(data == 0x00)
            console.log(data == 0x01)
            console.log('Received "' + data + '". ' + isNotif)
        })

        
    })
})