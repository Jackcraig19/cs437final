const mongoose = require('mongoose')

const friendSchema = new mongoose.Schema({
    friend1: mongoose.SchemaTypes.ObjectId,
    friend2: mongoose.SchemaTypes.ObjectId,
    isRequest: Boolean
})

module.exports = mongoose.model('friends', friendSchema)