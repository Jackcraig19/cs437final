const redis = require('redis')

const { REDIS_URI } = process.env

let client;

module.exports = { 
    connect: () => {
        client = redis.createClient({url:REDIS_URI})
        client.on('error', e => {
            console.log('Redis Error:')
            console.error(e)
        })
        client.connect().then(() => {
            console.log('Redis Connection Success')
        }).catch(() => {
            console.log('Redis Connection Fail')
        })

        // TODO: Figure out why json is not working. For now monkeypatch works
        client.json.get = async (key) => {
            return JSON.parse(await client.get(key))
        }
        client.json.set = async (key, data) => {
            return await client.set(key, JSON.stringify(data))
        }
    },
    // Could add a warning if client not initialized
    get: () => client
}