define(['backbone','jquery','underscore','_compare'], function(Backbone, $, undef, undef) {

	var DB = Backbone.DB = Backbone.Collection.extend({
		initialize: function(models, options) {
			options = options || {};
			this.initDb(options);
		},

		initDb: function(options) {
			this.endpoint = options.endpoint || '';

			this.pageLength = options.pageLength || 10;

			this.ajaxOptions = options.ajaxOptions;
		},

		request: function(data, initial, pageLength, ajaxOptions) {
			/**
			 * data: 
			 	- object: hash containing request parameters
			 	- string: id or cid
			 * range: 
				- array: [initial, final],
				- number: initial (final is calculated through 'this.perPage')
				- function: evaluate it.
			 * ajaxOptions: opitons to be passed to $.ajax
			 */

			var defer = $.Deferred();

			if (typeof data === 'object') {

				initial = _.isNumber(initial) ? initial : 0;
				pageLength = _.isNumber(pageLength) ? pageLength : this.pageLength;

				this._requestByParams(defer, data, initial, pageLength, ajaxOptions);

			} else if (typeof data === 'string' || typeof data === 'number') {

				this._requestById(defer, data, ajaxOptions);
			}

			// return the defer.
			return defer;
		},


		/**
		 * Tries to get a model by id (backbone collection.get(id))
		 * If unsuccessful, runs _asynchById
		 */
		_requestById: function(defer, id, ajaxOptions) {
			var model = this.get(id);

			if (model) {
				defer.resolve(model);
			} else {
				this._asynchById(defer, id, ajaxOptions);
			}
		},

		/**
		 * Fetches a model by ID from the endpoint.
		 * It is actually a facade for _asynchByParams
		 */
		_asynchById: function(defer, id, ajaxOptions) {
			var params = { id: id };

			this._asynchByParams(defer, params, 0, 1, ajaxOptions);
		},

		/**
		 * Filters the collection values by parameters.
		 * If unscuccessful, runs _asynchByParams
		 */
		_requestByParams: function(defer, params, initial, pageLength, ajaxOptions) {
			
			var loaded = _.chain(this.query(params))
								.rest(initial)
								.first(pageLength)
								.value();
/*
			console.log('ini ' + initial);
			console.log('total ' + this.query(params))
			console.log(loaded.length);
*/

			if (loaded && loaded.length === pageLength) {
				// if there are enough models to fill up the requested pageLength
				// return a resolved defer object, so that the interface may remain the same
				// for all requests.
				defer.resolve(loaded);
			} else {
				// if not, do the asynchronous request
				this._asynchByParams(defer, params, initial, pageLength, ajaxOptions);
			}
		},


		/**
		 * Requests models from the server.
		 */
		_asynchByParams: function(defer, params, initial, pageLength, ajaxOptions) {
				
			var _this = this,
				// add the initial and length parameters to the request data.
				serverSideParams = _.extend({
					initial: initial,
					pageLength: pageLength
				}, params),
				// build url
				url = this.url(serverSideParams),
				// run query
				query = $.ajax(url, _.extend(this.ajaxOptions, ajaxOptions));

			// when query is done:
			// 	parse it,
			//	add it,
			//	solve the defer with it.
			query.then(function(res) {
				var parsed = _this.parse(res);

				/**
				 * Collection end: if the parsed response is an empty array,
				 * consider the collection to be finished.
				 */
				if (!parsed || parsed.length === 0) {
					defer.resolve();
				}


				_this.add(parsed);

				// resolve the defer with parsed results.
				/**
				 * In order to keep paging working seamlessly,
				 * instead of directly solving the requestdefer with
				 * the parsed result, re-execute the synchronous query on the clien-side db
				 * and return models.
				 */
				_this._requestByParams(defer, params, initial, pageLength, ajaxOptions);
			});
		},



		/**
		 * A more powerful 'where' method that invokes _evaluateModel method.
		 */
		query: function(params) {
			var _this = this;
			
			return this.filter(function(model) {

				return _this._evaluateModel(model, params);
			});
		},

		/**
		 * loop through the models properties
		 */
		_evaluateModel: function(model, params) {
			var _this = this;

			return _.every(params, function(param, key) {
					// the param is param.
					// get the attr.
				var attr = model.get(key)
					// check if there is an attribute filter defined for the key
					attrFilter = _this.attrFilters[ key ];

				return (typeof attrFilter === 'function') ? attrFilter(attr, param) : attr === param;
			});
		},


		/**
		 * Object where the attribute filters are stored.
		 * 
		 */
		attrFilters: {},

		/**
		 * Defines a function to filter an attribute from a model.
		 */
		attrFilter: function(name, filter) {
			if (typeof name === 'string') {
				this.attrFilters[ name ] = filter;
			} else {
				var _this = this;
				_.each(name, function(filter, name) {
					_this.attrFilter(name, filter);
				});
			}

			return this;
		},

		/**
		 * Helper method that builds the url.
		 */
		url: function(params) {
			var jsonp = this.ajaxOptions.dataType === 'jsonp' ? '&callback=?' : '';

			return this.endpoint + '?' + $.param(params) + jsonp;
		},
	});

	return DB;
});