define(['backbone.db','jquery','underscore','backbone','_compare','backbone.listview'], function(DB, $, undef, Backbone, undef, ListView) {

	/**
	 * Collections
	 */

	/**
	 * Main database collection.
	 */
	window.books = new DB([], {
		endpoint: 'http://ler/cms/rest/book',
		pageLength: 6,
		ajaxOptions: {
			dataType: 'jsonp'
		}
	});

	// define the reader and reading filter.
	books.attrFilter(
		{
			reader_and_reading: function(a, p) {
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
			}
		}
	);


	/**
	 * Filter model
	 */
	var FilterModel = Backbone.Model.extend({
		/**
		 * Returns the parameters to be sent in data request
		 */
		parameters: function() {
			var params = {};

			_.each(this.attributes, function(value, key) {
				if (value && (_.isString(value) || _.isNumber(value)) ) {
					params[ key ] = value;
				} else if (_.isArray(value) && value.length > 0) {
					params[ key ] = value;
				}
			});

			return params;
		}
	})
	var filterModel = new FilterModel();


	/**
	 * Filtered books collection
	 */
	var FilteredCollection = Backbone.Collection.extend({
		initialize: function(models, options) {
			/**
			 * options:
			 *	- source
			 *	- filter
			 */
			_.bindAll(this,'restart','nextPage','reset','add','nextPage');

			this.source = options.source;
			this.filter = options.filter;

			this.filter.on('change', this.restart);

			// the page length
			this.page = 0;
			this.pageLength = 6;
		},

		restart: function() {
			this.source.request(this.filter.parameters(), 0, this.pageLength)
				.then(this.reset);
		},

		nextPage: function() {
			this.source.request(this.filter.parameters(), this.length, this.pageLength)
				.then(this.add);
		}
	})
	window.filteredBooks = new FilteredCollection([], {
		source: books,
		filter: filterModel
	});



	/**
	 * Views:
	 */

	/**
	 * Main database collection view.
	 */
	var allboks = new Backbone.ListView({
		el: $('#all'),
		collection: books,
		itemTemplate: function(data) {
			return '<li>' + data.title + ' - <span class="reader_and_reading">' + data.reader_and_reading.join('|') +  '</span></li>';
		},
		itemData: function(model) {
			return model.attributes;
		}
	});

	/**
	 * The filtered collection view.
	 */
	var filtered = new Backbone.ListView({
		el: $('#filtered'),
		collection: filteredBooks,
		itemTemplate: function(data) {
			return '<li>' + data.title + ' - <span class="reader_and_reading">' + data.reader_and_reading.join('|') +  '</span> </li>';
		},
		itemData: function(model) {
			return model.attributes;
		}
	});

	/**
	 * The filter view.
	 */
	var FilterView = Backbone.View.extend({
		initialize: function(options) {
			/**
			 * options:
			 *	- el,
			 *	- model
			 */

			this.model = options.model;
		},

		events: {
			'click #next': 'nextPage',
			'change input[name="reading"]': 'setReading',
			'change input[name="reader_and_reading"]': 'setTags',
		},

		nextPage: function() {
			filteredBooks.nextPage();
		},

		setReading: function() {
		//	var reading = this.$el.find('input[name="reading"]:checked').val();

		//	this.model.set('reading', reading);
		},

		setTags: function() {
			var reader_and_reading = _.map(this.$el.find('input[name="reader_and_reading"]:checked'), function(el) {
				return $(el).val();
			});

			this.model.set('reader_and_reading', reader_and_reading);
		},
	});

	var filterView = new FilterView({
		el: $('#filter'),
		model: filterModel
	})





	// start things up
	books.add(bootstrap);

});