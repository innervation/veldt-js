'use strict';

const lumo = require('lumo');
const defaultTo = require('lodash/defaultTo');
const WebGLRenderer = require('./WebGLRenderer');
const Point = require('./shape/Point');
const Quad = require('./shape/Quad');

const POINT_RADIUS = 8;
const POINT_RADIUS_INC = 4;

const createCollidables = function(tile, xOffset, yOffset) {
	const data = tile.data;
	const points = data.points;
	const hits = data.hits;
	const numHits = hits ? hits.length : 0;
	const radius = this.radius + this.outlineWidth;
	const collidables = new Array(numHits);
	for (let i=0; i<numHits; i++) {
		const x = points[i*2];
		const y = points[i*2+1];
		collidables[i] = new lumo.CircleCollidable(
			x,
			y,
			radius,
			xOffset,
			yOffset,
			tile,
			hits[i][0]);
	}
	return collidables;
};

class BinnedTopHits extends WebGLRenderer {

	constructor(options = {}) {
		super(options);
		this.point = null;
		this.atlas = null;
		this.quad = null;
		this.tree = null;
		this.color = defaultTo(options.color, [ 1.0, 0.4, 0.1, 0.8 ]);
		this.radius = defaultTo(options.radius, POINT_RADIUS);
		this.outlineColor = defaultTo(options.outlineColor, [ 0.0, 0.0, 0.0, 1.0 ]);
		this.outlineWidth = defaultTo(options.outlineWidth, 2.0);
	}

	onAdd(layer) {
		super.onAdd(layer);
		this.point = new Point(this);
		this.quad = new Quad(this);
		this.atlas = this.createVertexAtlas({
			chunkSize: this.layer.hitsCount * (this.layer.resolution * this.layer.resolution),
			attributePointers: {
				// position
				0: {
					size: 2,
					type: 'FLOAT'
				}
			}
		});
		this.tree = this.createRTreePyramid({
			createCollidables: createCollidables.bind(this)
		});
		return this;
	}

	onRemove(layer) {
		this.destroyVertexAtlas(this.atlas);
		this.destroyRTreePyramid(this.tree);
		this.atlas = null;
		this.tree = null;
		this.point = null;
		this.quad = null;
		super.onRemove(layer);
		return this;
	}

	pick(pos) {
		if (this.layer.plot.isZooming()) {
			return null;
		}
		return this.tree.searchPoint(
			pos.x,
			pos.y,
			this.layer.plot.zoom,
			this.layer.plot.getPixelExtent());
	}

	draw() {

		const gl = this.gl;
		const layer = this.layer;
		const plot = layer.plot;

		// bind render target
		plot.renderBuffer.bind();
		plot.renderBuffer.clear();

		// set blending func
		gl.enable(gl.BLEND);
		gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

		// render selected
		const selection = layer.getSelected();
		for (let i=0; i<selection.length; i++) {
			const selected = selection[i];
			this.point.drawIndividual(
				selected,
				this.radius + POINT_RADIUS_INC,
				this.color,
				this.outlineWidth,
				this.outlineColor);
		}

		// render highlighted
		if (layer.highlighted && !layer.isSelected(layer.highlighted)) {
			this.point.drawIndividual(
				layer.highlighted,
				this.radius,
				this.color,
				this.outlineWidth,
				this.outlineColor);
		}

		// unbind render target
		plot.renderBuffer.unbind();

		// render framebuffer to the backbuffer
		plot.renderBuffer.blitToScreen(this.layer.getOpacity());
		return this;
	}

}

module.exports = BinnedTopHits;
