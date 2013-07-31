define(['backbone.db','jquery'], function(DB, $) {


	window.books = new DB(bootstrap, {
		endpoint: 'http://ler/cms/rest/book',
		ajaxOptions: {
			dataType: 'jsonp'
		}
	});

	// define the reader and reading filter.
	books.attrFilter('reader_and_reading', function(a, p) {
		// a: attr, p: param
		var aIsArr = _.isArray(a),
			pIsArr = _.isArray(p);


		if (!aIsArr && !pIsArr) {
			// both are singles
			// true if equal
			return a === p;

		} else if (!aIsArr && pIsArr) {
			// param is array, attr is single
			// true if attr is in the parameter values
			return _.contains(p, a);

		} else if (aIsArr && !pIsArr) {
			console.log(_.contains(a, p))
			// attr is array, param is single
			// true if paramvalue is in attr
			return _.contains(a, p);

		} else {
			// both are arrays
			// true if attr contains ANY OF param
			return _.containsAny(a, p);
		}
	})
});