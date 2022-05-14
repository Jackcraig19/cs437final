const bcrypt = require('bcryptjs')
const jwt = require('jsonwebtoken')
let express = require('express')
let router = express.Router()

const User = require('../model/user')

const auth = require('../middleware/auth')

router.post('/register', async (req, res) => {
    try {
        const {username, password, email} = req.body
        console.log(username, req.body)
        if (!(email && password && username)) {
            return res.status(400).send("All Fields Required.")
        }

        const sameUser = await User.findOne({$or: [{email}, {username}]}).lean()
        if (sameUser) {
            if (sameUser.username === username)
                return res.status(400).send('Username Already Exists.')
            else
                return res.status(400).send('Email Already in Use.')
        }
        let hashWord = await bcrypt.hash(password, 10);

        const newUser = await User.create({
            username,
            email: email.toLowerCase(),
            password: hashWord
        })

        const token = jwt.sign(
            {user_id: newUser._id, email},
            process.env.TOKEN_KEY,
            {
                expiresIn: "24h"
            }
        )

        newUser.token = token
        await newUser.save()
        return res.status(200).json({email: newUser.email, token: newUser.token})
    } catch (e) {
        res.sendStatus(500)
        console.error(e)
    }
})

router.post('/login', async (req, res) => {
    try {
        const {email, password} = req.body
        if (!(email && password)) {
            return res.status(400).send('All Fields Required.')
        }

        const user = await User.findOne({email})
        if (user && (await bcrypt.compare(password, user.password))) {
            // Success, very nice
            const token = jwt.sign(
                {user_id: user._id, email},
                process.env.TOKEN_KEY,
                {
                    expiresIn: '24h'
                }
            )

            user.token = token
            await user.save()
            return res.status(200).json({username: user.username, token: user.token})
        }
        return res.status(400).send('Username or Password Incorrect.')

    } catch(e) {
        console.error(e)
        return res.sendStatus(500)
    }
})

router.post('/logout', auth, async (req, res) => {
    await User.findOneAndUpdate({_id: req.user.user_id}, {token: ''})
    res.sendStatus(200)
})

router.get('/verify', auth, async (req, res) => {
    res.sendStatus(200)
})

router.get('/', auth, async (req, res) => {
    let user = await User.findOne({_id: req.user.user_id}).lean()
    delete user.passsword
    res.json(user)
})

router.get('/:uid', auth, async (req, res) => {
    let user = await User.findOne({_id: req.params.uid}).lean()
    delete user.password
    res.json(user)
})
module.exports = router