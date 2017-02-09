'use strict'

/**
 * This bot will handle every mail with subject 'upload to PATH'
 * Every attachment in those mails will be saved to folder 'SENDER/PATH'
 *
 * Usage:
 * - set environment variables GMAIL_USER and GMAIL_PASSWORD or edit this file
 * - run script
 * - send mails to user with subject beginning with 'upload to '
 **/

const { createBot } = require('./bot')
const { mkdirs, createWriteStream, writeFile } = require('fs-promise') // eslint-disable-line no-unused-vars
const path = require('path')

const ROOT = process.env.UPLOAD_ROOT || 'uploads'


// Returns target path from subject
const trigger = ({ headers }) => {
	if (headers.subject.toLowerCase().substring(0, 10) === 'upload to ') {
		return headers.subject.substring(10)
	} else {
		return false
	}
}

// Save attachments to provided path
const mailHandler = ({ from, attachments }, uploadDir) => {
	const dir = path.join(ROOT, from[0].address, uploadDir)
	return mkdirs(dir).then(() => Promise.all(attachments.map(saveAttachment(dir))))
}

/* stream version if you'd like to turn on streamAttachments
const saveAttachment = dir => ({ stream, fileName }) => {
	const target = createWriteStream(path.join(dir, fileName))
	stream.pipe(target)
	return new Promise((resolve, reject) => {
		const onEnd = () => {
			stream.removeListener('error', onError)
			resolve()
		}
		const onError = err => {
			stream.removeListener('end', onEnd)
			reject(err)
		}
		stream.once('end', onEnd)
		stream.once('error', onError)
	})
}
*/

const saveAttachment = dir => ({ content, fileName }) => {
	return writeFile(path.join(dir, fileName), content)
}

const errorHandler = (err, context /*, mail */) => {
	console.error(context, err) // eslint-disable-line no-console
	if (context === 'MAIL') {
		// TODO send error mail to tell user his file has not been saved
	}
}

const bot = createBot({
	imap: {
		user: process.env.GMAIL_USER,
		password: process.env.GMAIL_PASSWORD,
		host: 'imap.googlemail.com',
		port: 993,
		keepalive: true,
		tls: true,
		tlsOptions: {
			rejectUnauthorized: false
		},
	},
	markSeen: false,
	streamAttachments: false,
	trigger,
	triggerOnHeaders: true,
	mailHandler,
	errorHandler
})

bot.start()
