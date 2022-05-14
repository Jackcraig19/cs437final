import 'react-native-gesture-handler'

import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View, Button, TextInput, Modal, Image, KeyboardAvoidingView } from 'react-native';
import { NavigationContainer, useNavigation, useFocusEffect } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack'
import { createDrawerNavigator, DrawerContentScrollView, DrawerItem, DrawerItemList } from '@react-navigation/drawer';
import * as SecureStorage from 'expo-secure-store'
import * as React from 'react'
import { Buffer } from 'buffer'
import { BleManager, fullUUID } from 'react-native-ble-plx'

const API_BASE = '10.27.2.224:8080'
const HOOP_SERVICE_ID = '00001818-000a-1000-8000-00805f9b34fc'
const HOOP_CHAR_COLOR_ID = '00001818-000a-1000-8000-00805f9b34fa' // Get color of hoop
const HOOP_CHAR_ACTIVE_ID = '00001818-000a-1000-8000-00805f9b34fd' // Get if other game is being played on hoop
const HOOP_CHAR_SCORE_ID = '00001818-000a-1000-8000-00805f9b34fb' // Get score events

const AuthContext = React.createContext()
const Drawer = createDrawerNavigator()
const Stack = createStackNavigator()

const manager = new BleManager()

const COLOR_MAP = {
  '00': 'Blue',
  '01': 'Red',
  '02': 'Yellow',
  '03': 'Green'
}

const pollGame = async (accessToken, setGame) => {
  // Update state with stuff
  const gameRes = await fetch('http://' + API_BASE + '/play/get', { headers: { 'x-access-token': accessToken } })
  if (gameRes.status != 200)
    return console.log('Error in game poll ' + await gameRes.text())
  const gameResJSON = await gameRes.json()
  if (!gameResJSON.success)
    return console.log('Failure in game poll ' + gameResJSON.reason)
  setGame(gameResJSON.game)
}

const getHoopConnections = (hoopIds) => new Promise(async (accept, reject) => {
  let sub
  let foundHoops = []

  const timeout = setTimeout(async () => {
    console.log('Timeout')
    sub.remove()
    manager.stopDeviceScan()
    for (const device of foundHoops)
      await manager.cancelDeviceConnection(device.id)
    return reject()
  }, 10000)


  sub = manager.onStateChange(state => {
    if (state === 'PoweredOn') {
      sub.remove()

      manager.startDeviceScan([HOOP_SERVICE_ID], { allowDuplicates: false }, (err, device) => {
        if (err) {
          return console.error(err)
        }
        if (hoopIds.includes(device.id)) {
          if (foundHoops.includes(device.id)) {
            return
          }
          manager.connectToDevice(device.id).then(async device => {
            await device.discoverAllServicesAndCharacteristics()
            console.log('Connected to ' + device.id)
            foundHoops.push(device)
            if (foundHoops.length == 2) {
              clearTimeout(timeout)
              accept(foundHoops)
            }
          }).catch(err => {
            console.log('Cannot connect to')
            console.error(err)
          })
        }
      })
    } else {
      console.log('Manager not ready ' + state)
    }
  }, true)
})

const HomeScreen = () => {
  const [invites, setInvites] = React.useState([])

  const authContext = React.useContext(AuthContext)

  React.useEffect(async () => {
    const doInviteLookup = async () => {
      const inviteRes = await fetch('http://' + API_BASE + '/play/invite/list', { headers: { 'x-access-token': authContext.state.userToken } })
      if (inviteRes.status != 200)
        return
      const inviteJSON = await inviteRes.json()
      setInvites(inviteJSON.invites)
    }
    const timeout = setInterval(doInviteLookup, 500)
    await doInviteLookup()
    return () => {
      clearInterval(timeout)
    }


  }, [])

  const navigation = useNavigation()

  return (
    <View style={{ backgroundColor: 'red', minHeight: '100%', width: '100%', display: 'flex', alignItems: 'center' }}>
      <Text style={{ color: 'white', fontSize: 52, margin: 40 }}>WeHoop</Text>
      <View style={{ display: 'flex', width: '50%', backgroundColor: 'white' }}>
        <View>
          <Text style={
            { width: '100%', textAlign: 'center', fontSize: 24 }}>Game Invites</Text>
          {
            invites.map(invite => {
              return (
                <View key={invite} style={{ ...styles.handlebars, width: '90%' }}>
                  <Button title="Accept" onPress={async () => {
                    const r = await fetch('http://' + API_BASE + '/play/invite/accept', {
                      method: 'POST',
                      headers: { 'x-access-token': authContext.state.userToken, 'content-type': 'application/json' },
                      body: JSON.stringify({ gameId: invite })
                    })
                    if (r.status != 200)
                      return
                    const rJSON = await r.json()
                    if (!rJSON.success)
                      return
                    navigation.navigate('Game Manager', { screen: 'Game Lobby', params: { game: rJSON.game } })
                  }} />
                  <Button title="Reject" onPress={async () => {
                    const r = await fetch('http://' + API_BASE + '/play/invite/reject', {
                      method: 'POST',
                      headers: { 'x-access-token': authContext.state.userToken, 'content-type': 'application/json' },
                      body: JSON.stringify({ gameId: invite })
                    })
                  }} />
                </View>
              )
            })}
        </View>
      </View>
      <StatusBar style="auto" />
    </View>
  )
}

const ActiveGameScreen = ({ navigation, route }) => {
  const { court } = route.params
  const [game, setGame] = React.useState(route.params.game)
  const [hoops, setHoops] = React.useState(route.params.hoops ? route.params.hoops : [])
  const [didScan, setDidScan] = React.useState(false)
  const [isOwner, setIsOwner] = React.useState(false)
  const authContext = React.useContext(AuthContext)

  // Assume hoops are connected if they exist
  React.useEffect(async () => {
    fetch('http://' + API_BASE + '/play/owner', { headers: { 'x-access-token': authContext.state.userToken } }).then(async (res) => {
      if (res.status == 200) {
        const rJSON = await res.json()
        setIsOwner(rJSON.isOwner)
      }
    })
    if (didScan)
      return
    setDidScan(true)
    try {
      let hoopDevices
      if (hoops.length != 2) {
        hoopDevices = await getHoopConnections(court.hoopIds)
        setHoops(hoopDevices)
      } else {
        hoopDevices = hoops
      }

      const handler = (err, scoreChar, isHoop1) => {
        if (err) {
          console.error(err)
          return
        }
        const sendScoreReq = async (isHoop1) => await fetch('http://' + API_BASE + '/play/scorepoint', {
          method: 'POST',
          headers: {'x-access-token': authContext.state.userToken, 'content-type': 'application/json'},
          body: JSON.stringify({side: isHoop1 ? 'team1' : 'team2'})
        })
        sendScoreReq(isHoop1).then(async (res) => {
          if (res.status != 200) {
            return console.log('Score Req Failed: ' + await res.text())
          }
          const rJson = await res.json()
          if (!rJson.success)
            console.log('Score Req No Success: ' + rJson.reason)
          console.log('Score Req Success')
        })
        return
      }
      const h1Handler = (err, scoreChar) => handler(err, scoreChar, true)
      const h2Handler = (err, scoreChar) => handler(err, scoreChar, false)
      const hoop1Sub = manager.monitorCharacteristicForDevice(hoopDevices[0].id, HOOP_SERVICE_ID, HOOP_CHAR_SCORE_ID, h1Handler)
      const hoop2Sub = manager.monitorCharacteristicForDevice(hoopDevices[1].id, HOOP_SERVICE_ID, HOOP_CHAR_SCORE_ID, h2Handler)
      console.log('Score Handlers Registered')
      return () => {
        hoop1Sub.remove()
        hoop2Sub.remove()
      }
    } catch (e) {
      console.error(e)
      console.log('Active Game: Get Hoops Failed')
    }
  }, [])

  useFocusEffect(React.useCallback(() => {
    const gameInterval = setInterval(() => pollGame(authContext.state.userToken, setGame), 200)
    return () => clearInterval(gameInterval)
  }))


  return (
    <View style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-around', alignItems: 'center', minHeight: '100%' }}>
      <View style={{ display: 'flex', flexDirection: 'row', width: '80%', justifyContent: 'space-between' }}>
        <View style={{ width: 150, borderWidth: 2, borderColor: '#FF0000', padding: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-evenly', height: 100, backgroundColor: '#FF9999' }}>
          <Text style={{ color: 'white', fontSize: 18 }}>Team 1</Text>
          <Text style={{ color: 'white', fontSize: 36 }}>{game.team1Score + ''}</Text>
        </View>
        <View style={{ width: 150, borderWidth: 2, borderColor: '#FF0000', padding: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-evenly', height: 100, backgroundColor: '#FF9999' }}>
          <Text style={{ color: 'white', fontSize: 18 }}>Team 2</Text>
          <Text style={{ color: 'white', fontSize: 36 }}>{game.team2Score + ''}</Text>
        </View>
      </View>
      <View>
        <Text>Playing to: {game.scoreLimit + ""}</Text>
      </View>
      {isOwner &&
        <Button title="End Game" onPress={() => {
          fetch('http://' + API_BASE + '/play/endgame', {
            method: 'POST',
            headers: { 'x-access-token': authContext.state.userToken }
          }).then(res => {
            console.log(res.status)
            navigation.reset({
              index: 0,
              routes: [{ name: 'Create Game' }]
            })
            navigation.navigate('Home')
          })
        }} />
      }
    </View>
  )
}

const GameLobbyScreen = ({ navigation, route }) => {
  const [court, setCourt] = React.useState(route.params.court ? route.params.court : { color: '' })
  const [hoops, setHoops] = React.useState([])
  const [game, setGame] = React.useState(route.params.game)
  const [userData, setUserData] = React.useState({})
  const [isModalActive, setIsModalActive] = React.useState(false)
  const [myFriends, setMyFriends] = React.useState([])
  const [isOwner, setIsOwner] = React.useState(false)
  const [didScan, setDidScan] = React.useState(false)
  const authContext = React.useContext(AuthContext)

  useFocusEffect(React.useCallback(() => {
    const gameInterval = setInterval(() => {
      pollGame(authContext.state.userToken, setGame)
      if (game.startTime) {
        navigation.navigate('Active Game', { game: game, court: court })
      }
    }, 200)
    return () => clearInterval(gameInterval)
  }))


  React.useEffect(async () => {
    // get friends of user
    const friendRes = await fetch('http://' + API_BASE + '/friends/', { headers: { 'x-access-token': authContext.state.userToken } })
    const friendResJSON = await friendRes.json()
    setMyFriends(friendResJSON.friends)

    // check if court doesnt exist
    if (court.color === '') {
      const courtRes = await fetch('http://' + API_BASE + '/court/get/' + game.courtId, {
        headers: { 'x-access-token': authContext.state.userToken }
      })
      const courtResJSON = await courtRes.json()
      setCourt(courtResJSON.court)
    }

    // check if I am owner
    const ownerRes = await fetch('http://' + API_BASE + '/play/owner', { headers: { 'x-access-token': authContext.state.userToken } })
    const ownerResJSON = await ownerRes.json()
    if (ownerResJSON.isOwner) {
      setIsOwner(true)
    } else
      setIsOwner(false)
  }, [])

  React.useEffect(async () => {
    if (!isOwner)
      return
    if (didScan)
      return
    setDidScan(true)
    try {
      setHoops(await getHoopConnections(court.hoopIds))
    } catch (e) {
      console.log('Lobby: Get Hoop Connections Failed')
    }
    return async () => {
      console.log('Cleaning Lobby')
    }
  }, [isOwner])

  React.useEffect(async () => {
    const openInvites = game.openInvites ? game.openInvites : []
    const requiredUsers = [...openInvites, ...game.team1, ...game.team2]
    let newUserData = {}
    for (const userId of requiredUsers) {
      if (!(userId in userData)) {
        const uRes = await fetch('http://' + API_BASE + '/user/' + userId, { headers: { 'x-access-token': authContext.state.userToken } })
        const uResJSON = await uRes.json()
        newUserData[userId] = uResJSON.username
      } else {
        newUserData[userId] = userData[userId]
      }
    }
    setUserData(newUserData)
  }, [game])

  return (
    <View style={{ backgroundColor: '#FF0000', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'space-evenly', minHeight: '100%' }}>
      <Modal
        animationType='slide'
        transparent={false}
        visible={isModalActive}
        onRequestClose={() => setIsModalActive(false)}
      >
        <View style={styles.container}>

          {myFriends.map(friend => {
            let inviteComp = <Button title="Invite" onPress={() => fetch('http://' + API_BASE + '/play/invite/send', {
              method: 'POST',
              headers: { 'x-access-token': authContext.state.userToken, 'content-type': 'application/json' },
              body: JSON.stringify({ rec_id: friend.fId })
            })
            } />
            if (game.openInvites && game.openInvites.includes(friend.fId))
              inviteComp = <Text> Invited </Text>
            if (game.team1.includes(friend.fId) || game.team2.includes(friend.fId))
              inviteComp = <Text>In Game</Text>
            return (
              <View key={friend.fId} style={styles.handlebars}>
                <Text>{friend.uName}</Text>
                {inviteComp}
              </View>
            )
          })}

          <Button title="Done" onPress={() => setIsModalActive(false)} />
        </View>
      </Modal>
      <Text style={{ color: 'white', fontSize: 72 }}>{COLOR_MAP[court.color]} Court</Text>
      {isOwner && (
        <View style={styles.subBox}>
          <Text>Invites</Text>
          {game.openInvites ? game.openInvites.map(
            uId => {
              if (uId in userData)
                return <Text key={uId}>{userData[uId]}</Text>
              return <Text key={uId}></Text>
            }) : <Text>No Invites</Text>}
          <Button title="Invite Friend" onPress={() => setIsModalActive(true)} />
        </View>
      )}
      <View style={{ display: 'flex', flexDirection: 'row', justifyContent: 'space-between', width: '80%', alignItems: 'center' }}>
        <View style={{ minWidth: 120, backgroundColor: 'white', minHeight: 100 }}>
          {game.team1.map(uId => {
            if (uId in userData)
              return <Text key={uId} style={{ textAlign: 'center', textAlignVertical: 'center', padding: 5, borderColor: 'gray', borderWidth: 1, margin: 2 }}>{userData[uId]}</Text>
            return <Text key={uId}></Text>
          })}
        </View>
        <Button title="Change Team" onPress={async () => {
          await fetch('http://' + API_BASE + '/play/changeteam', { headers: { 'x-access-token': authContext.state.userToken } })
        }}
          style={{ color: 'white' }} />
        <View style={{ minWidth: 120, backgroundColor: 'white', minHeight: 100 }}>
          {game.team2.map(uId => {
            if (uId in userData)
              return <Text key={uId} style={{ textAlign: 'center', textAlignVertical: 'center', padding: 5, borderColor: 'gray', borderWidth: 1, margin: 2 }}>{userData[uId]}</Text>
            return <Text key={uId}></Text>
          })}
        </View>
      </View>
      {isOwner && (
        <View style={styles.handlebars}>
          <Button title="Cancel" onPress={() => {
            fetch('http://' + API_BASE + '/play/endgame', { method: 'POST', headers: { 'x-access-token': authContext.state.userToken } }).then(() => {
              navigation.reset({
                index: 0,
                routes: [{ name: 'Create Game' }]
              })
              navigation.navigate('Home')
            })
          }} />
          <Button title="Start Game" onPress={async () => {
            const startRes = await fetch('http://' + API_BASE + '/play/startgame', {
              method: 'POST',
              headers: { 'x-access-token': authContext.state.userToken }
            })
            if (startRes.status != 200)
              return
            const startResJSON = await startRes.json()
            if (!startResJSON.success)
              return console.log('Start Game Failed: ' + startResJSON.reason)
            navigation.navigate('Active Game', { game: startResJSON.game, court: court, hoops: hoops })
          }}
          />
        </View>
      )}
    </View>
  )
}

const CreateGameScreen = ({ navigation }) => {
  const [foundHoops, setFoundHoops] = React.useState({})
  const [isModalActive, setIsModalActive] = React.useState(false)
  const [chosenCourt, setChosenCourt] = React.useState('')
  const [isBTReady, setIsBTReady] = React.useState(false)

  React.useEffect(() => {
    const sub = manager.onStateChange(state => {
      if (state === 'PoweredOn') {
        console.log('BLE State On!')
        setIsBTReady(true)
        sub.remove()
      } else {
        console.log('BLE State Not On ' + state)
        setIsBTReady(false)
      }

      // Cleanup after page unmounts
      return () => sub.remove()
    }, true)
  }, [])


  const ctx = React.useContext(AuthContext)
  React.useEffect(() => {
    if (isBTReady) {
      let scannedDevices = new Set()
      console.log('Starting Device Scan')
      manager.startDeviceScan([HOOP_SERVICE_ID], { allowDuplicates: false }, async (error, device) => {
        if (error) {
          return console.error(error)
        }
        // Avoid duplicate scans
        if (scannedDevices.has(device.id)) {
          return
        }
        console.log('Found Device')
        scannedDevices.add(device.id)

        // Establish connection and discover services + characteristics
        await device.connect()
        await device.discoverAllServicesAndCharacteristics()

        // Get hoop color
        const colorChar = await device.readCharacteristicForService(HOOP_SERVICE_ID, HOOP_CHAR_COLOR_ID)
        const color = Buffer.from(colorChar.value, 'base64').toString('hex')

        await device.cancelConnection()
        setFoundHoops(prevFoundHoops => {
          if (color in prevFoundHoops) {
            return { ...prevFoundHoops, [color]: [...prevFoundHoops[color], device.id] }
          } else {
            return { ...prevFoundHoops, [color]: [device.id] }
          }
        })
      })
    }
  }, [isBTReady])

  const startGameOnHoop = async () => {
    // TODO: Loading Screen
    const courtRes = await fetch('http://' + API_BASE + '/court/get', {
      method: 'POST',
      headers: { 'x-access-token': ctx.state.userToken, 'content-type': 'application/json' },
      body: JSON.stringify({ hoops: foundHoops[chosenCourt] })
    })
    if (courtRes.status != 200) {
      console.log('Get Court Req Fail: ' + await courtRes.text())
      return
    }
    const courtResJSON = await courtRes.json()
    if (!courtResJSON.success) {
      console.log('Get Court Failed: ' + courtResJSON.reason)
      return
    }
    // Try creating the game
    const newGameRes = await fetch('http://' + API_BASE + '/play/createGame', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-access-token': ctx.state.userToken
      },
      body: JSON.stringify({
        courtId: courtResJSON.courtId
      })
    })
    if (newGameRes.status != 200) {
      console.log('Create Game Req Failed: ' + await newGameRes.text())
      return
    }
    const newGameResJSON = await newGameRes.json()
    if (!newGameResJSON.success) {
      console.log('New Game Failed: ' + newGameResJSON.reason)
      return
    }
    console.log('Create Game Successful. GameId: ' + newGameResJSON.gameId)
    setIsModalActive(false)
    navigation.navigate('Game Lobby', { court: courtResJSON.court, game: newGameResJSON.game })
  }

  return (
    <View style={styles.container}>
      <Modal
        animationType='slide'
        transparent={false}
        visible={isModalActive}
        onRequestClose={() => setIsModalActive(false)}
      >
        <View style={styles.container}>
          <Text>You Sure You Want to Start a Game on the {COLOR_MAP[chosenCourt]} Court?</Text>
          <Button
            title='No'
            onPress={() => setIsModalActive(false)}
          />
          <Button
            title='Yes'
            onPress={startGameOnHoop}
          />
        </View>
      </Modal>
      <Text style={{fontSize: 24}}>Found Courts:</Text>
      {
        Object.keys(foundHoops).map(hoopColor => {
          console.log('Found hoop!')
          if (foundHoops[hoopColor].length != 2)
            return (
              <View key={hoopColor} style={styles.handlebars}>
                <Text style={{fontSize: 24}}>{COLOR_MAP[hoopColor]} Court</Text>
                <Text style={{fontSize: 18}}>1/2</Text>
              </View>
            )
          return (
            <View key={hoopColor} style={styles.handlebars}>
              <Button
                key={hoopColor}
                title={COLOR_MAP[hoopColor] + ' Court'}
                onPress={() => {
                  setIsModalActive(true)
                  setChosenCourt(hoopColor)
                }}
              />
              <Text>2/2</Text>
            </View>
          )
        })
      }
      <StatusBar style="auto" />
    </View>

  )
}

const GameManager = ({ }) => {
  return (
    <Stack.Navigator >
      <Stack.Screen name="Create Game" component={CreateGameScreen} />
      <Stack.Screen name="Game Lobby" component={GameLobbyScreen} />
      <Stack.Screen name="Active Game" component={ActiveGameScreen} />
    </Stack.Navigator>
  )
}

const SignInScreen = () => {
  const [email, setEmail] = React.useState('')
  const [password, setPassword] = React.useState('')

  const { signIn } = React.useContext(AuthContext)
  return (
    <AuthContext.Consumer>
      {ctx => {
        return (
          <KeyboardAvoidingView style={{ ...styles.container, ...styles.red }} behavior="position">
            <Text style={{fontSize: 48, color: 'white'}}>WeHoop</Text>
            <View style={{ backgroundColor: 'white' }}>
              <Text style={{ color: 'red' }}>{ctx.state.error}</Text>
              <TextInput
                onChangeText={setEmail}
                value={email}
                placeholder="Email"
                style={styles.input}
              />
              <TextInput
                onChangeText={setPassword}
                value={password}
                placeholder="Password"
                style={styles.input}
              />
              <Button title="Sign In" onPress={() => signIn({ email, password })} />
            </View>
            <StatusBar style="auto" />
          </KeyboardAvoidingView>
        )
      }}
    </AuthContext.Consumer>
  )
}

const SignUpScreen = ({ navigation }) => {
  const [username, setUsername] = React.useState('')
  const [password, setPassword] = React.useState('')
  const [email, setEmail] = React.useState('')

  const { signUp } = React.useContext(AuthContext)
  return (
    <AuthContext.Consumer>
      {ctx => (
        <KeyboardAvoidingView style={styles.container} behavior="padding">
          <Text style={{ color: 'red' }}>{ctx.state.error}</Text>
          <TextInput
            onChangeText={setUsername}
            value={username}
            placeholder="Public Username"
            style={styles.input}
          />
          <TextInput
            onChangeText={setEmail}
            value={email}
            placeholder="Email"
            style={styles.input}
          />
          <TextInput
            onChangeText={setPassword}
            value={password}
            placeholder="Password"
            style={styles.input}
          />
          <Button title="Sign Up" onPress={async () => {
            await signUp({ username, password, email })
            navigation.closeDrawer()
          }} />
          <StatusBar style="auto" />
        </KeyboardAvoidingView>
      )}
    </AuthContext.Consumer>
  )
}

const AppBody = () => {

  const authContext = React.useContext(AuthContext)
  const navigation = useNavigation()

  // Used to check if a user is already in a game. If so, navigate them to the appropriate screen
  React.useEffect(async () => {
    const gameCheckRes = await fetch('http://' + API_BASE + '/play/get', {
      method: 'GET',
      headers: { 'x-access-token': authContext.state.userToken }
    })
    if (gameCheckRes.status != 200)
      console.log('Game Check Req Failed: ' + await gameCheckRes.text())
    else {
      const gameCheckJSON = await gameCheckRes.json()
      if (!gameCheckJSON.success)
        console.log('Game Check Failed: ' + gameCheckJSON.reason)
      else {
        // User was in a game!
        let court
        let isOwner = false
        // Was user the owner of a game
        const ownerRes = await fetch('http://' + API_BASE + '/play/owner', { headers: { 'x-access-token': authContext.state.userToken } })
        if (ownerRes.status != 200)
          console.log('Owner Req Failed: ' + await ownerRes.text())
        else {
          const ownerResJSON = await ownerRes.json()
          if (!ownerResJSON.success)
            console.log('Owner Check Failed: ' + ownerResJSON.reason)
          else
            if (ownerResJSON.isOwner) {
              isOwner = true
              // I am owner! Need to get hoopIds
              const hoopIdsRes = await fetch('http://' + API_BASE + '/court/get/' + gameCheckJSON.game.courtId, { headers: { 'x-access-token': authContext.state.userToken } })
              // TODO: Validation
              const hoopIdsResJSON = await hoopIdsRes.json()
              court = hoopIdsResJSON.court
            }
        }
        if (gameCheckJSON.game.startTime)
          navigation.navigate('Game Manager', { screen: 'Active Game', params: { court: court, game: gameCheckJSON.game, isOwner: isOwner } })
        else
          navigation.navigate('Game Manager', { screen: 'Game Lobby', params: { court: court, game: gameCheckJSON.game, isOwner: isOwner } })
      }
    }
  }, [])

  return (
    <Drawer.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: 'white', height: 100 }
      }}
      drawerContent={props => (
        <DrawerContentScrollView {...props}>
          <DrawerItemList {...props} />
          {authContext.state.userToken ? (
            <DrawerItem label="Logout" onPress={async () => {
              await authContext.signOut()
            }} />
          ) : (<></>)}

        </DrawerContentScrollView>
      )}>
      {authContext.state.userToken ? (
        <>
          <Drawer.Screen name="Home" component={HomeScreen} />
          <Drawer.Screen name="Game Manager" component={GameManager} options={{ headerShown: false }} />
        </>
      ) : (
        <>
          <Drawer.Screen name="Sign In" component={SignInScreen} />
          <Drawer.Screen name="Sign Up" component={SignUpScreen} />
        </>
      )}
    </Drawer.Navigator>
  )
}

export default function App() {
  // TODO: Probably don't need some of this state in the AuthContext
  const [state, dispatch] = React.useReducer(
    (prevState, action) => {
      switch (action.type) {
        case 'NO_TOKEN':
          return {
            ...prevState,
            userToken: null,
            isLoading: false,
            error: '',
          }
        case 'RESTORE_TOKEN':
          return {
            ...prevState,
            userToken: action.token,
            isLoading: false,
            error: '',
          }
        case 'SIGN_IN':
          return {
            ...prevState,
            isSignout: false,
            userToken: action.token,
            error: '',
          }
        case 'SIGN_OUT':
          return {
            ...prevState,
            isSignout: true,
            userToken: null,
            error: '',
          }
        case 'FAIL':
          return {
            ...prevState,
            error: action.message
          }
      }
    },
    {
      isLoading: true,
      isSignout: false,
      userToken: null,
      error: ''
    }
  )

  React.useEffect(async () => {
    let userToken
    try {
      userToken = await SecureStorage.getItemAsync('userToken')
    } catch (e) {
      dispatch({ type: 'NO_TOKEN' })
      return
    }
    try {
      const status = await fetch('http://' + API_BASE + '/user/verify', {
        headers: { 'x-access-token': userToken }
      })
      if (status.status == 200) {
        dispatch({ type: 'RESTORE_TOKEN', token: userToken })
        return
      } else {
        dispatch({ type: 'NO_TOKEN' })
        return
      }
    } catch (e) {
      console.error(e)
      dispatch({ type: 'NO_TOKEN' })
      return
    }
  }, [])

  const authContext = React.useMemo(() => ({
    state: state,
    signIn: async data => {
      const res = await fetch('http://' + API_BASE + '/user/login', {
        method: 'POST',
        body: JSON.stringify({ email: data.email, password: data.password }),
        headers: { 'content-type': 'application/json' }
      })
      if (res.status == 200) {
        const jsRes = await res.json()
        await SecureStorage.setItemAsync('userToken', jsRes.token)
        dispatch({ type: 'SIGN_IN', token: jsRes.token })
        return
      }
      console.log('Sign in fail')
      dispatch({ type: 'FAIL', message: await res.text() })
    },
    signOut: async () => {
      await fetch('http://' + API_BASE + '/user/logout', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-access-token': state.userToken
        }
      })
      await SecureStorage.setItemAsync('userToken', '')
      dispatch({ type: 'SIGN_OUT' })
    },
    signUp: async data => {
      const res = await fetch('http://' + API_BASE + '/user/register', {
        method: 'POST',
        body: JSON.stringify({ email: data.email, password: data.password, username: data.username }),
        headers: { 'content-type': 'application/json' }
      })
      if (res.status == 200) {
        const data = await res.json()
        await SecureStorage.setItemAsync('userToken', data.token)
        return dispatch({ type: 'SIGN_IN', token: data.token })
      }
      dispatch({ type: 'FAIL', message: await res.text() })
    }
  }), [state])

  if (state.isLoading)
    return (<View />)

  return (
    <AuthContext.Provider value={authContext}>
      <NavigationContainer>
        <AppBody />
      </NavigationContainer>
    </AuthContext.Provider>
  );
}

const styles = StyleSheet.create({
  red: {
    backgroundColor: '#FF0000'
  },
  container: {
    flex: 1,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  input: {
    borderWidth: 1,
    borderColor: 'black',
    padding: 5,
    margin: 15,
    minWidth: '50%'
  },
  subBox: {
    padding: 10,
    margin: 25,
    borderColor: 'black',
    borderWidth: 1,
    borderRadius: 5
  },
  subBoxLR: {
    padding: 5,
    margin: 5,
    borderColor: 'black',
    borderWidth: 1,
    display: 'flex',
    flexDirection: 'row',
    justifyContent: 'space-evenly'
  },
  subContainer: {
    display: 'flex',
    flexDirection: 'column',
    borderWidth: 1,
    borderColor: 'black',
    padding: 2,
    margin: 2,
  },
  handlebars: {
    width: '60%',
    minHeight: 20,
    display: 'flex',
    flexDirection: 'row',
    justifyContent: 'space-between'
  }
});
