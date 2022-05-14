const mongoose = require('mongoose')

const courtSchema = new mongoose.Schema({
    hoopIds: Array,
    // location: 
})

module.exports = mongoose.model('court', courtSchema)