const mongoose = require('mongoose')

const gameSchema = new mongoose.Schema({
    courtId: mongoose.SchemaTypes.ObjectId,
    ownerId: mongoose.SchemaTypes.ObjectId,
    scoreLimit: Number,
    timeLimit: Number,
    teamSize: Number,
    team1Score: {type: Number, default: 0},
    team2Score: {type: Number, default: 0},
    startTime: {type: mongoose.SchemaTypes.Date, default: null},
    team1: {type: Array, default: []},
    team2: {type: Array, default: []},
    isActive: {type: Boolean, default: true}
})

module.exports = mongoose.model('game', gameSchema)