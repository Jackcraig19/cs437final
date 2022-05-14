const mongoose = require('mongoose')

const { MONGO_URI } = process.env

exports.connect = () => {
    mongoose.connect(MONGO_URI, {
        useNewUrlParser: true,
        useUnifiedTopology: true,
    }).then(() => console.log('DB Connection Successful')).catch(e => {
        console.log('DB Connection Failed')
        console.error(e)
        process.exit(1)
    })
}