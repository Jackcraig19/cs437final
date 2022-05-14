let express = require('express')
let router = express.Router()
const ObjectId = require('mongoose').Types.ObjectId

const User = require('../model/user')
const Friends = require('../model/friends')

const auth = require('../middleware/auth')

const aggFriends = async (userId, isRequest) => {
    let match = { $or: [{ friend1: ObjectId(userId) }, { friend2: ObjectId(userId) }], isRequest: false }
    if (isRequest) {
        // Only get friends where the other person has requested
        match = { friend2: ObjectId(userId), isRequest: true }
    }
    const senderLookup = {
        from: 'users',
        let: { 'id': '$friend1' },
        pipeline: [
            { $match: { '$expr': { '$eq': ['$_id', '$$id'] } } },
            { $project: { _id: 1, username: 1 } },
        ],
        as: 'senders'
    }
    // Group query res depending on if we are looking for requests or not
    let pipeCap = [
        {
            $group: {
                _id: { sId: '$sId', sUname: '$sUname' },
                friends: { $addToSet: { rId: '$rId', rUname: '$rUname' } },
            }
        },
        {
            $facet: {
                userIsSender: [
                    { $match: { '_id.sId': ObjectId(userId) } },
                    { $unwind: '$friends' },
                    { $project: { _id: 0, fId: '$friends.rId', fUname: '$friends.rUname' } }
                ],
                userIsReceiver: [
                    { $match: { '_id.sId': { $ne: ObjectId(userId) } } },
                    { $project: { fId: '$_id.sId', fUname: '$_id.sUname', _id: 0 } }
                ]
            }
        },
        // Maybe it would be good to keep the information about who sent the friend req? If so, end pipeline
        {
            $project: { t: { $concatArrays: ['$userIsSender', '$userIsReceiver'] } }
        },
        {
            $unwind: '$t'
        },
        {
            $project: { fId: '$t.fId', uName: '$t.fUname' }
        }

    ]
    if (isRequest) {
        pipeCap = [
            { $project: { sId: 1, sUname: 1 } }
        ]
    }
    const receiverLookup = { ...senderLookup, let: { 'id': '$friend2' }, as: 'receivers' }
    const res = await Friends.aggregate([
        { $match: match },
        { $lookup: senderLookup },
        { $lookup: receiverLookup },
        { $unwind: '$receivers' },
        { $unwind: '$senders' },
        { $project: { rId: '$receivers._id', rUname: '$receivers.username', sId: '$senders._id', sUname: '$senders.username', _id: 0 } },
        ...pipeCap
    ])

    return res
}

// Gets all friends of user
router.get('/', auth, async (req, res) => {
    // TODO: error validation
    const reqs = await aggFriends(req.user.user_id, false)
    return res.json({friends: reqs})
})

// Gets all friend requests
router.get('/requests', auth, async (req, res) => {
    // TODO: error validation
    const reqs = await aggFriends(req.user.user_id, true)
    return res.json({ friendReqs: reqs })
})

// Sends a friend request
router.post('/send', auth, async (req, res) => {
    // TODO: Verify no friend request already exists
    await Friends.create({
        friend1: req.user.user_id,
        friend2: req.body.rec_id,
        isRequest: true
    })
    return res.sendStatus(200)
})

// Accept a friend request
router.post('/accept', auth, async (req, res) => {
    // TODO: Check how many docs were modified, return error if none were modified
    await Friends.findOneAndUpdate({ friend2: req.user.user_id, friend1: req.body.sen_id }, { isRequest: false })
    return res.sendStatus(200)
})

// Reject a friend request
router.post('/reject', auth, async (req, res) => {
    await Friends.findOneAndDelete({friend1: req.body.sen_id, friend2: req.user.user_id})
    return res.sendStatus(200)
})



module.exports = router