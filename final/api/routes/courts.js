let express = require('express')
let router = express.Router()

const auth = require('../middleware/auth')

const Court = require('../model/court')

router.post('/get/', auth, async (req, res) => {
    const {hoops} = req.body
    if (!hoops || hoops.length != 2)
        return res.status(400).send('Missing Fields')
    const court = await Court.findOne({hoopIds: {$all: hoops}}).lean()
    if (!court)
        return res.json({success: false, reason: 'No Court Exists'})
    return res.json({success: true, courtId: court._id})
})

router.get('/get/:courtId', auth, async (req, res) => {
    const { courtId } = req.params
    console.log(courtId)
    const court = await Court.findById(courtId).lean()
    return res.json({court})
})

module.exports = router