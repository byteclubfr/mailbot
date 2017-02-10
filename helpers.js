'use strict'

const talon = require('talon')
const address = require('address-rfc2822')
const stripTags = require('./striptags')
const debug = require('debug')('mailbot')


// Helper: extract signature from text body

exports.extractSignature = text => talon.signature.bruteforce.extractSignature(text)


// Helper: parse addresses (needed when working with triggerOnHeaders)

exports.parseAddresses = (headers, { quiet = false } = {}) => {
	_parseAddressHeader(headers, 'to', quiet)
	_parseAddressHeader(headers, 'cc', quiet)
	_parseAddressHeader(headers, 'bcc', quiet)
	return headers
}

const _parseAddressHeader = (headers, field, quiet = false) => {
	let addresses = headers[field]
	if (typeof addresses === 'string') {
		addresses = [addresses]
	} else if (!addresses) {
		addresses = []
	}
	headers[field] = addresses.map(address => _parseAddressValue(address, quiet))
}

const _parseAddressValue = (value, quiet = false) => {
	let parsed
	try {
		parsed = address.parse(value)[0]
	} catch (err) {
		debug('Error parsing address', value, err)
		if (quiet) {
			parsed = {}
		} else {
			throw err
		}
	}
	parsed.raw = value
	return parsed
}


// Helper: strip tags

exports.stripTags = stripTags
