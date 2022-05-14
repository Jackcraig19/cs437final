let express = require('express')
let router = express.Router()
const redisClient = require('../config/redis').get()
const redisJSON = redisClient.json

const Game = require('../model/game')
const User = require('../model/user')
const Court = require('../model/court')

const auth = require('../middleware/auth')

const DEFAULT_SCORE_LIMIT = 21
const DEFAULT_TIME_LIMIT = 60 * 15
const DEFAULT_TEAM_SIZE = 3

// TODO: Figure out notification system for when game is over

// Maybe make this a websocket thing? For now avoid web sockets
// Gets user's current game, or if gameId is defined in body, get stored stats for that game
// TODO: Make it only active games, historicals can be accessed from the /history endpoint
router.get('/get', auth, async (req, res) => {
    const userId = req.user.user_id
    let gameId = req.query.gameId || req.query.gameid
    if (!gameId)
        gameId = await redisClient.get('player:' + userId)
    if (gameId) {
        const game = await redisJSON.get('game:' + gameId)
        if (!game)
            return res.json({ success: false, reason: 'Game Does Not Exist' }) // This should never happen
        return res.json({ success: true, game: game })
    }
    return res.sendStatus(400)
})

router.get('/invite/list', auth, async (req, res) => {
    const userId = req.user.user_id
    const inviteObj = await redisJSON.get('invite:' + userId)
    if (!inviteObj)
        return res.json({ invites: [] })
    return res.json({ invites: inviteObj.openInvites })
})

router.post('/invite/accept', auth, async (req, res) => {
    const { gameId } = req.body
    const userId = req.user.user_id
    if (!gameId)
        return res.status(400).send('Missing Fields')
    // Check if user is actually invited
    const inviteObject = await redisJSON.get('invite:' + userId)
    if (!inviteObject || !inviteObject.openInvites.includes(gameId))
        return res.json({ success: false, reason: 'Invite Does Not Exist' })
    // Check if game registered invite. This should be an assert, only case when this is invalid is some kind
    // of race condition that could be fixed with a transaction
    let gameObject = await redisJSON.get('game:' + gameId)
    const playerIndex =  gameObject.openInvites ? gameObject.openInvites.indexOf(userId) : -1 // Used later on, avoid 2 searches
    if (playerIndex < 0)
        return res.json({ success: false, reason: 'Invite Does Not Exist' })
    // Check if player is already in a game
    const curGameId = await redisClient.get('player:' + userId)
    if (curGameId)
        return res.json({ success: false, reason: 'Leave Current Game Before Joining a New One' })
    // Activate player
    await redisClient.set('player:' + userId, gameId)
    // Store new game and invite object
    let game = await redisJSON.get('game:' + gameId)
    game.openInvites.splice(playerIndex, 1)
    if (game.team1.length > game.team2.length)
        game.team2.push(userId)
    else
        game.team1.push(userId)
    await redisJSON.set('game:' + gameId, game)
    await redisClient.del('invite:' + userId)
    return res.json({ success: true, game: game })
})

router.post('/invite/reject', auth, async (req, res) => {
    const { gameId } = req.body
    const userId = req.user.user_id
    if (!gameId)
        return res.status(400).send('Missing Fields')
    let inviteObject = await redisJSON.get('invite:' + userId)
    let inviteIdx = inviteObject ? inviteObject.openInvites.indexOf(gameId) : -1
    if (inviteIdx < 0)
        return res.json({success: false, reason: 'Invite Does Not Exist'})
    let gameObject = await redisJSON.get('game:' + gameId)
    let gameInviteIdx = gameObject.openInvites ? gameObject.openInvites.indexOf(userId) : -1
    if (gameInviteIdx < 0)
        return res.json({success: false, reason: 'Invite Does Not Exist'})
    // Remove invites from invitations and game
    inviteObject.openInvites.splice(inviteIdx, 1)
    if (gameObject.openInvites) // Should always be true if this guy was invited
        gameObject.openInvites.splice(gameInviteIdx, 1)
    if (inviteObject.openInvites.length > 0)
        await redisJSON.set('invite:' + userId, inviteObject)
    else
        await redisClient.del('invite:' + userId)
    await redisJSON.set('game:' + gameId, gameObject)
    return res.json({success: true})
})

router.post('/invite/send', auth, async (req, res) => {
    const userId = req.user.user_id
    const recepientId = req.body.rec_id
    if (!recepientId)
        return res.status(400).send('Missing Fields')
    // Check if game, user is owner of game, and game is not started
    // Could also lookup in Mongo, but all resources needed are in Redis
    const gameId = await redisClient.get('player:' + userId)
    if (!gameId)
        return res.json({ success: false, reason: 'Cannot Send Invite if Not in Game' })
    let game = await redisJSON.get('game:' + gameId)
    if (!game)
        return res.json({ success: false, reason: 'Game Does Not Exist' })
    if (game.ownerId !== userId)
        return res.json({ success: false, reason: 'Cannot Send Invite if Not Game Owner' })
    // Make sure not already invited
    if (game.openInvites && game.openInvites.includes(recepientId))
        return res.json({ success: false, reason: 'Already Invited' })
    // Create invite and store
    let currentInvites = await redisJSON.get('invite:' + recepientId)
    if (!currentInvites)
        await redisJSON.set('invite:' + recepientId, { openInvites: [gameId] })
    else
        await redisJSON.set('invite:' + recepientId, { openInvites: [...currentInvites.openInvites, gameId] })
    // Add invite to game
    if (game.openInvites)
        game.openInvites.push(recepientId)
    else
        game.openInvites = [recepientId]
    await redisJSON.set('game:' + gameId, game)
    return res.json({ success: true })
})

router.get('/changeteam', auth, async (req, res) => {
    const userId = req.user.user_id
    const gameId = await redisClient.get('player:' + userId)
    if (!gameId)
        return res.json({success: false, reason: 'Not In Game'})
    let game = await redisJSON.get('game:' + gameId)
    if (!game)
        return res.json({success: false, reason: 'Game Does Not Exist'})
    let teamIdx = game.team1.indexOf(userId)
    if (teamIdx > -1) {
        // Player is on team 1; put them on team 2
        game.team1.splice(teamIdx, 1)
        game.team2.push(userId)
    } else {
        teamIdx = game.team2.indexOf(userId)
        if (teamIdx < 0)
            return res.json({success: false, reason: 'Not In Game'})
        game.team2.splice(teamIdx, 1)
        game.team1.push(userId)
    }
    await redisJSON.set('game:' + gameId, game)
    return res.json({success: true, game: game})
})

router.post('/scorepoint', auth, async (req, res) => {
    console.log(req.body)
    const { side } = req.body
    if (!side)
        return res.status(400).send('Missing Fields')
    const userId = req.user.user_id
    const gameId = await redisClient.get('player:' + userId)
    if (!gameId)
        return res.json({success: false, reason: 'Not In Game'})
    let game = await redisJSON.get('game:' + gameId)
    if (!game)
        return res.json({success: false, reason: 'Game Does Not Exist'})
    if (game.ownerId !== userId)
        return res.json({success: false, reason: 'Must be Owner to Register Score'})
    if (game.startTime == null)
        return res.json({success: false, reason: 'Game Has Not Started'})
    if (side === 'team1')
        game.team1Score += 1
    else if (side === 'team2')
        game.team2Score += 1
    else
        return res.json({success: false, reason: 'Invalid Team Value'})
    await redisJSON.set('game:' + gameId, game)
    return res.json({success: true, game: game})
})

// Would prob be better with a cronjob rather than taking request from client
// Would make stack to large for current scope tho
router.post('/endGame', auth, async (req, res) => {
    // TODO: Store game in DB only if it was completed (time limit ran out or score limit reached)
    const gameId = await redisClient.get('player:' + req.user.user_id)
    if (!gameId)
        return res.json({ success: false, reason: 'Not in Game' })
    let game = await redisJSON.get('game:' + gameId)
    // Check game exists and user is owner
    if (!game)
        return res.json({ success: false, reason: 'Game Does Not Exist or Has Finished Already' })
    if (game.ownerId !== req.user.user_id)
        return res.json({ success: false, reason: 'Cannot End Game if Not Owner' })
    // Go through players, deactivate them
    const deactivatePlayer = async playerId => {
        await redisClient.del('player:' + playerId)
    }
    game.team1.map(deactivatePlayer)
    game.team2.map(deactivatePlayer)
    // Update mongo record
    await Game.findByIdAndUpdate(gameId, {
        team1Score: game.team1Score,
        team2Score: game.team2Score,
        isActive: false
    })
    // Remove from redisStore
    await redisClient.del('game:' + gameId)
    return res.json({ success: true })
})

router.post('/startGame', auth, async (req, res) => {
    const gameId = await redisClient.get('player:' + req.user.user_id)
    if (!gameId)
        return res.json({ success: false, reason: 'Not in Game' })
    const game = await redisJSON.get('game:' + gameId)
    if (!game)
        return res.json({success: false, reason: 'Game Does Not Exist'})
    if (game.ownerId !== req.user.user_id)
        return res.json({ success: false, reason: 'Must be Owner of Game to Start' })
    if (game.startTime)
        return res.json({ success: false, reason: 'Game Already Started' })
    if (game.team1.length > game.teamSize || game.team2.length > game.teamSize)
        return res.json({success: false, reason: 'One Team is Too Large'})
    if (game.team1.length != game.team2.length)
        return res.json({success: false, reason: 'Teams Are Unbalanced'})
    // Remove all open invitations
    if (game.openInvites) {
        for (const inviteId of game.openInvites) {
            let cInvites = await redisJSON.get('invite:' + inviteId)
            const gameIdx = cInvites.openInvites.indexOf(gameId)
            if (gameIdx < 0) // Should be impossible
                continue
            cInvites.openInvites.splice(gameIdx, 1)
            if (cInvites.openInvites.length == 0)
                await redisClient.del('invite:' + inviteId)
            else
                await redisJSON.set('invite:' + inviteId, cInvites)
        }
    }
    game.openInvites = null
    game.startTime = Date.now()
    await redisJSON.set('game:' + gameId, game)
    return res.json({ success: true, game: game })
})

router.post('/createGame', auth, async (req, res) => {
    // Make sure user is not in another game
    // TODO: Validate reqCourtId is a valid court
    let { courtId, scoreLimit, timeLimit, teamSize } = req.body
    if (!courtId)
        return res.status(400).send('Missing Fields')
    if (!scoreLimit)
        scoreLimit = DEFAULT_SCORE_LIMIT
    if (!timeLimit)
        timeLimit = DEFAULT_TIME_LIMIT
    if (!teamSize)
        teamSize = DEFAULT_TEAM_SIZE
    const activePlayer = await redisClient.get('player:' + req.user.user_id)
    if (activePlayer) {
        return res.json({ success: false, reason: 'Player Already in Game' })
    }
    try {
        const court = await Court.findById(courtId).lean()
        if (!court)
            return res.json({ sucess: false, reason: 'Court Does Not Exist' })
    } catch (e) {
        // Can check the error and make sure it matches with the court not existing (e.g. bad ObjectId)
        return res.json({ sucess: false, reason: 'Court Does Not Exist' })
    }
    // Make sure court is not in another game. Could do something similar to check if player is in game,
    // but for now is simpler to just do this
    const activeCourt = await Game.findOne({ courtId: courtId, isActive: true })
    if (activeCourt) {
        return res.json({ success: false, reason: 'Court Already in Use' })
    }
    // Create game object
    let newGame = await Game.create({
        courtId: courtId,
        ownerId: req.user.user_id,
        timeLimit: timeLimit,
        scoreLimit: scoreLimit,
        teamSize: teamSize,
        team1: [req.user.user_id]
    })
    // Insert new game and activate player. Could, prob should be a transaction
    await redisClient.set('player:' + req.user.user_id, newGame._id.toString())
    await redisJSON.set('game:' + newGame._id, newGame)

    return res.json({ success: true, game: newGame })
})

router.get('/owner', auth, async (req, res) => {
    const userId = req.user.user_id
    const gameId = await redisClient.get('player:' + userId)
    if (!gameId)
        return res.json({success: false, reason: 'Not in Game'})
    const game = await redisJSON.get('game:' + gameId)
    let isOwner = false
    if (game.ownerId === userId)
        isOwner = true
    return res.json({success: true, isOwner: isOwner})
})

module.exports = router

/**
REDIS OBJECTS

inviteSchema
userId => {
    openInvites: [gameId, gameId, gameId...]
}

playerSchema
userId -> gameId

gameSchema = {
    courtId: courtID
    ownerUID: userId,
    scoreLimit: Integer,
    teamSize: Ingeger
    timeLimit: Integer, (seconds)
    startTime: Timestamp,                   <--- fr?
    team1: [userId],
    team2: [userId],
    openInvites: [userId]
}, ID: UUID? Or something Create game in mongodb, get that ID?

 */