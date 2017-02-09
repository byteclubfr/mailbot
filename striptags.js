'use strict'

const strip = require('striptags')

module.exports = html => {
	// make sure it's a string
	html = String(html)

	// exclude empty strings
	if (!html) return ''

	// ensure new lines for paragraphs
	html = html.replace(/<\/p>/g, '<br>')

	// fix some "<" tags
	html = html.replace(/<([^!\/a-z])/gi, '&lt$1')

	// strip tags
	var text = strip(html)

	// remove new line duplicates (we don't care this information)
	text = text.replace(/\n+/g, '\n')

	// remove space duplicates
	text = text.replace(/[ \t]+/g, ' ')

	// trim
	text = text.replace(/^\s*/, '').replace(/\s*$/, '')

	return text
}
