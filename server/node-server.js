'use strict';

const express = require('express');
const winston = require('winston');
const helmet = require('helmet');
const nodeProxy = require('./node-proxy');
const authPassport = require('./auth-passport');
const bodyParser = require('body-parser');
const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const fs = require('fs')
var path = require('path');
let users;
var request = require("request");
const packageJson = require('package-json');

/**
 * Heroku-friendly production http server.
 *
 * Serves your app and allows you to proxy APIs if needed.
 */

const app = express();
const PORT = process.env.PORT || 8080; // set in package.json to 3100. I don't know why 8080 is here'
const distPath = path.join(__dirname, '../dist');
const indexFileName = 'index.html';


authPassport.readUsers()
  .then((_users) => {
    users = _users;
  })
  .catch((err) => {
    throw err;
  });

// Enable various security helpers.
app.use(helmet());

app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

app.use(passport.initialize());
app.use(passport.session());

passport.use(new LocalStrategy(
  (username, password, done) => {
    authPassport.authenticateUser(username, password, users)
      .then((authResult) => {
        return done(null, authResult);
      })
      .then(null, (message) => {
        return done(null, false, message);
      });
  }

));

passport.serializeUser((user, done) => {
  done(null, user.meta.id);
});

passport.deserializeUser((id, done) => {
  done(null, authPassport.getUserById(id, users));
});

// APIs


app.post('/api/auth/login',
  passport.authenticate('local'),
  (req, res) => {
    console.log('logging in ' + JSON.stringify(req.user));
    res.status(200).send(JSON.stringify(req.user));
  }
);

app.get('/api/claim', getRecords('claim'));
app.get('/api/rebuttal', getRecords('rebuttal'));
app.get('/api/claimRebuttal', getRecords('claimRebuttal'));
app.get('/api/contact', getRecords('contact'));
app.post('/api/contact', saveARecord('contact'));
app.get('/api/crisis', getRecords('crisis'));
app.get('/api/hero', getRecords('hero'));
app.get('/api/crisis/:id', getRecord('crisis'));
app.get('/api/note', getRecords('note'));
app.get('/api/users', getRecords('user'));
app.post('/api/note', saveARecord('note'));
app.post('/api/hero', saveARecord('hero'));

app.get('/api/deps/:package', getDependencies());

function getRecords(table) {
  const GOOGLE_SHEET_API = 'https://script.google.com/macros/s/AKfycbzRNPSnpecG8pjxXMkrV3yb3ezw2jYXz7nNwTPeOJH4tbPyOoE/exec';

  switch(table) {
    case 'claim':
    case 'claim-rebuttal':
    case 'rebuttal':
      if(process.env.NODE_ENV === 'production') {
        return function(req, res) {
          request(`${GOOGLE_SHEET_API}?table=${table}`, function(error, response, body) {
            res.send(body);
          });
        }
      }
    default:
      return function(req, res) {
        res.sendFile(path.join(__dirname, '/db/' + table + '.json'));
      }
  }
}

function getRecord(table) {
  return function(req, res) {
    let id = req.params['id'];
    let fileName = path.join(__dirname, '/db/' + table + '.json')
    fs.readFile(fileName, (err, data) => {
      if(err) throw err;
      let dbRecords = JSON.parse(data);
      let record = dbRecords.find(record => record.id === +id);
      res.send(JSON.stringify(record));
    })
  }
}

function saveARecord(table) {
  return function(req, res) {
    let fileName = path.join(__dirname, '/db/' + table + '.json')
    let reqRecord = req.body;
    fs.readFile(fileName, (err, data) => {
      if(err) throw err;
      let dbRecords = JSON.parse(data);
      if(dbRecords.some(function(record) { return record.id === reqRecord.id })) {
        dbRecords = dbRecords.map(record => record.id === reqRecord.id ? reqRecord : record)
      } else {
        dbRecords.push(reqRecord);
      }
      fs.writeFile(fileName, JSON.stringify(dbRecords), (err) => {
        if(err) throw err;    // TODO: send the unchanged version back and revert the change
        console.log('Its saved!');
      });
      res.send(JSON.stringify(req.body));
    });
  }
}

function getDependencies() {
  return function(req, res) {
    let pkg = req.params.package;
    packageJson(pkg, 'latest').then(json => {
      res.send(json.dependencies)
    });
  }
}

// API proxy logic: if you need to talk to a remote server from your client-side
// app you can proxy it though here by editing ./proxy-config.js
// just there to let you pipe any 3rd party server requests from the browser through your own backend so you avoid CORS issues
nodeProxy(app);

// all other routes are handled by Angular
app.use(express.static(distPath));
app.get('*', (req, res) => res.sendFile(path.join(distPath, indexFileName)));

// Start up the server.
app.listen(PORT, (err) => {
  if(err) {
    winston.error(err);
    return;
  }

  winston.info(`Listening on port ${PORT}`);
});
