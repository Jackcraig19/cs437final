const jwt = require('jsonwebtoken')
const User = require('../model/user')

const config = process.env

const verifyToken = async (req, res, next) => {
    const token = req.body.token || req.query.token || req.headers['x-access-token']
    if (token === '')
        return res.status(403).send('Authentication Failed.')
    try {
        const decoded = jwt.verify(token, config.TOKEN_KEY)
        const user = await User.findOne({_id: decoded.user_id, token: token})
        if (!user)
            return res.status(401).send('Authentication Failed.')
        req.user = decoded
    } catch (e) {
        console.error(e)
        return res.status(401).send('Authentication Failed.')
    }
    return next()
}

module.exports = verifyToken