define(['backbone'], function(Backbone) {

	/**
	 * Filtered books collection
	 */
	var Filtered = Backbone.Collection.extend({
		initialize: function(models, options) {
			this.initFiltered(options);
		},

		initFiltered: function(options) {
			/**
			 * options:
			 *	- db
			 *	- filter
			 *	- pageLength
			 */
			_.bindAll(this,'resetRequest','nextPage','reset','add','parameters');

			/**
			 * db is the Backbone.DB object that will respond to queries
			 */
			this.db = options.db;
			
			this.filter = options.filter || new Backbone.Model();

			/**
			 * listen to changes on the filter
			 */
			this.listenTo(this.filter, 'change', this.resetRequest);


			/** 
			 * parameters is a function to be run to retrieve the query parameters.
			 */
			this.parameters = options.parameters || this.parameters;

			/**
			 * Page lengh may be a function or a value it will be passed on to the db.
			 */
			this.pageLength = options.pageLength || this.pageLength;

		},

		pageLength: 10,

		parameters: function(filter) {
			return filter.attributes;
		},

		_parameters: function() {
			return typeof this.parameters === 'function' ? this.parameters(this.filter) : this.parameters;
		},

		/**
		 * fetches next page by passing the length of this collection as initial parameter
		 * to db.request(params, initial, pageLength)
		 */
		nextPage: function() {
				// get parameters
			var params = this._parameters(),
				// the index at which start the query
				initial = this.length,
				// the length of results to be returned
				pageLength = typeof this.pageLength === 'function' ? this.pageLength() : this.pageLength;

			this.db.request(params, initial, pageLength)
				// add results to this collection
				.then(this.add);
		},

		/**
		 * Resets this collection with data newly retrieved from the database.
		 */
		resetRequest: function() {
				// get parameters
			var params = this._parameters(),
				// initial index
				initial = 0,
				pageLength = typeof this.pageLength === 'function' ? this.pageLength() : this.pageLength;

			this.db.request(params, initial, pageLength)
				// reset this collection with the models.
				.then(this.reset);
		},
	});

	return Filtered;
});