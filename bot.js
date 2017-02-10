'use strict'

const imap = require('./imap')
const { parseAddresses, stripTags, extractSignature } = require('./helpers')
const { MailParser } = require('mailparser') // Requires 0.x as 2.x will fail listing all attachments
const debug = require('debug')('mailbot')


const MATCH_CID = /<img .*?src=["']?cid:(.+?)(<|>|\n|"|'|\s|$).*?>/gi
const REPLACE_CID = '{[CID($1)]}'
const MATCH_CID_TOKENS = /\{\[CID\(.*?\)\]\}/gi
const CID_TOKEN_PREFIX_LEN = REPLACE_CID.indexOf('$1')
const CID_TOKEN_SUFFIX_LEN = REPLACE_CID.length - CID_TOKEN_PREFIX_LEN - 2
const RE_SUBJECT_PREFIX = /^(?:(?:R[eé]f?|Fwd|Forward)[:\.]\s*)* /i

const createBot = (conf = {}) => {
	conf = Object.assign({
		imap: Object.assign({
			// user,
			// password,
			host: 'imap.googlemail.com',
			port: 993,
			keepalive: true,
			tls: true,
			tlsOptions: {
				rejectUnauthorized: false,
			},
		}, conf.imap),
		mailbox: 'INBOX',
		filter: ['UNSEEN'],
		markSeen: true,
		triggerOnHeaders: false,
		trigger: mail => false, // eslint-disable-line no-unused-vars
		mailHandler: (mail, trigger) => {}, // eslint-disable-line no-unused-vars
		errorHandler: (error, context) => console.error('MailBot Error', context, error), // eslint-disable-line no-console
		autoReconnect: true,
		autoReconnectTimeout: 5000,
		streamAttachments: true,
		removeTextSignature: true,
		ignoreAttachmentsInSignature: true,
		cleanSubject: true,
	}, conf)

	const handleError = (context, mail, uid) => error => {
		debug('Error', context, error)

		if (uid) {
			// Remove from 'doneUids'
			doneUids = doneUids.filter(_uid => _uid !== uid)
			// Note: we don't automatically retry later, it could be an option
			// Instead, this mail will not be checked again unless marked as unread (depends on options and filters) and a new mail is received
		}

		Promise.resolve()
		.then(() => conf.errorHandler(error, context, mail))
		.catch(err => console.error('MAILBOT: ErrorHandler Error!', context, err)) // eslint-disable-line no-console
	}

	const handleMail = (mail, triggerResult, uid) => {
		Promise.resolve()
		.then(() => formatMail(mail))
		.then(() => conf.mailHandler(mail, triggerResult))
		.catch(handleError('MAIL', mail, uid))
	}

	// Reformat mail: ignore images embedded in signature, extract text signature, etc…
	const formatMail = mail => {
		// Extract text signature
		if (conf.removeTextSignature && mail.text) {
			const extract = extractSignature(mail.text)
			mail.textOriginal = mail.text
			mail.textSignature = extract.signature
			mail.text = extract.text
			debug('Extracted text signature')
		} else {
			mail.textOriginal = null
			mail.textSignature = null
		}
		// Ignore attachments embedded in signature
		mail.ignoredAttachments = []
		if (conf.ignoreAttachmentsInSignature && mail.html && mail.attachments) {
			// Replace IMG tags with CID by a token to not lose them when stripping tags
			const html = mail.html.replace(MATCH_CID, REPLACE_CID)
			const text = stripTags(html)
			const extract = extractSignature(text)
			if (extract && extract.signature) {
				// Extract CID tokens from signature
				const found = extract.signature.match(MATCH_CID_TOKENS) || []
				const cids = found.map(token => token.substring(CID_TOKEN_PREFIX_LEN, token.length - CID_TOKEN_SUFFIX_LEN))
				const { kept, ignored } = mail.attachments.reduce((result, attachment) => {
					if (attachment.contentId && cids.includes(attachment.contentId)) {
						result.ignored.push(attachment)
					} else {
						result.kept.push(attachment)
					}
					return result
				}, { ignored: [], kept: [] })
				debug('Ignored attachments in HTML signature:', ignored.length)
				mail.attachments = kept
				mail.ignoredAttachments = ignored
			}
		}
		// Cleanup subject
		if (conf.cleanSubject) {
			mail.cleanSubject = mail.subject.replace(RE_SUBJECT_PREFIX, '')
		} else {
			mail.cleanSubject = null
		}
	}

	// Do not fetch same mail multiple times to properly handle incoming emails
	let doneUids = []

	// Current client:
	// We replace the instance whenever connection info change
	let client = null
	let shouldRecreateClient = false

	const initClient = () => {

		// Open mailbox
		client.once('ready', () => {
			debug('IMAP ready')
			client.openBoxP(conf.mailbox, false)
			.then(() => {
				debug('Mailbox open')
				return search()
			})
			.then(watch, watch) // whatever happened
		})

		const watch = () => client.on('mail', search)

		const search = nb => {
			if (nb !== undefined) {
				debug('New mail', nb)
			}
			return client.searchP(conf.filter)
			.then(uids => {
				const newUids = uids.filter(uid => !doneUids.includes(uid))
				debug('Search', newUids)
				// Optimistically mark uids as done, this prevents double-triggers if a mail
				// is received while we're handling one and option 'markSeen' is not enabled
				doneUids = uids
				return newUids
			})
			.then(fetchAndParse)
			.catch(handleError('SEARCH'))
		}

		client.on('close', err => {
			debug('IMAP disconnected', err)
			if (err && conf.autoReconnect) {
				debug('Trying to reconnect…')
				setTimeout(() => client.connect(), conf.autoReconnectTimeout)
			} else {
				debug('No reconnection (user close or no autoReconnect)')
			}
		})

		client.on('error', handleError('IMAP_ERROR'))

		const fetchAndParse = source => {
			debug('Fetch', source)
			const fetcher = client.fetch(source, {
				bodies: '',
				struct: true,
				markSeen: conf.markSeen,
			})
			fetcher.on('message', parseMessage)
			return new Promise((resolve, reject) => {
				fetcher.on('end', resolve)
				fetcher.on('error', reject)
			})
		}

	}

	const parseMessage = (message, uid) => {
		debug('Parse message')

		const parser = new MailParser({
			debug: conf.debugMailParser,
			streamAttachments: conf.streamAttachments,
			showAttachmentLinks: true,
		})

		// Message stream, so we can interrupt parsing if required
		let messageStream = null

		// Result of conf.trigger, testing if mail should trigger handler or not
		let triggerResult
		if (conf.triggerOnHeaders) {
			parser.on('headers', headers => {
				triggerResult = Promise.resolve().then(() => conf.trigger({ headers }))
				triggerResult.then(result => {
					if (result) {
						debug('Triggered (on headers)', { result, subject: headers.subject })
					} else {
						debug('Not triggered (on headers)', { result, subject: headers.subject })
						debug('Not triggered: Immediately interrupt parsing')
						messageStream.pause()
						parser.end()
					}
					return result
				})
			})
		}

		// Once mail is ready and parsed…
		parser.on('end', mail => {
			// …check if it should trigger handler…
			if (!conf.triggerOnHeaders) {
				triggerResult = Promise.resolve().then(() => conf.trigger(mail))
				triggerResult.then(result => {
					if (result) {
						debug('Triggered (on end)', { result, subject: mail.subject })
					} else {
						debug('Not triggered (on end)', { result, subject: mail.subject })
					}
				})
			}
			// …and handle it if applicable
			triggerResult
			.then(result => result && handleMail(mail, result, uid))
			.catch(handleError('TRIGGER', mail, uid))
		})

		// Stream mail once ready
		message.once('body', stream => {
			messageStream = stream
			stream.pipe(parser)
		})
	}

	// Public bot API
	return {

		start () {
			debug('Connecting…')
			if (!client || shouldRecreateClient) {
				client = imap(conf.imap)
			}
			initClient()
			client.connect()
			return new Promise((resolve, reject) => {
				const onReady = () => {
					debug('Connected!')
					client.removeListener('error', onError)
					resolve()
				}
				const onError = err => {
					debug('Connection error!', err)
					client.removeListener('ready', onReady)
					reject(err)
				}
				client.once('ready', onReady)
				client.once('error', onError)
			})
		},

		stop (destroy = false) {
			debug('Stopping (' + (destroy ? 'BRUTAL' : 'graceful') + ')…')
			if (destroy) {
				console.warn('destroy() should be used with high caution! Use graceful stop to remove this warning and avoid losing data.') // eslint-disable-line no-console
			}
			client[destroy ? 'destroy' : 'end']()
			return new Promise((resolve, reject) => {
				const onEnd = () => {
					debug('Stopped!')
					client.removeListener('error', onError)
					resolve()
				}
				const onError = err => {
					debug('Stop error!', err)
					client.removeListener('end', onEnd)
					reject(err)
				}
				client.once('end', onEnd)
				client.once('error', onError)
			})
		},

		restart (destroy = false) {
			return this.stop(destroy).then(() => this.start())
		},

		configure (option, value, autoRestart = true, destroy = false) {
			conf[option] = value
			if (autoRestart && (option === 'imap' || option === 'mailbox' || option === 'filter')) {
				shouldRecreateClient = true
				return this.restart(destroy)
			}
			return Promise.resolve()
		},

	}
}


// Public API

module.exports = {

	// Main function
	createBot,

	// Helpers
	parseAddresses,
	extractSignature,
	stripTags,

}
