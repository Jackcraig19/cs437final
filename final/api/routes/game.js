let express = require('express')
let router = express.Router()

const auth = require('../middleware/auth')

router.get('/', async (req, res) => {
    res.json({
        
    })
})


module.exports = router