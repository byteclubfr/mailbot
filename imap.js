'use strict'

const Imap = require('imap')

const PROMISIFIED_METHODS = ['openBox', 'search']

const promisify = (fn, self) => (...args) => new Promise((ok, fail) =>
	fn.call(self, ...args, (err, res) =>
		err ? fail(err) : ok(res)
	)
)

module.exports = options => {
	const client = new Imap(options)
	PROMISIFIED_METHODS.forEach(prop => {
		client[prop + 'P'] = promisify(client[prop], client)
	})
	return client
}
