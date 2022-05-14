require('dotenv').config()
require('./config/database').connect()
require('./config/redis').connect()
const express = require('express')

const port = process.env.PORT || '8080'

const app = express()

app.use(express.json())

app.use('/play', require('./routes/play'))
app.use('/history', require('./routes/game'))
app.use('/user', require('./routes/user'))
app.use('/friends', require('./routes/friends'))
app.use('/court', require('./routes/courts'))

app.listen(port, () => console.log('App listening on port ' + port))