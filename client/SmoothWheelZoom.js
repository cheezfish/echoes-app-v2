// Leaflet SmoothWheelZoom — vendored locally
// https://github.com/mutsuyuki/Leaflet.SmoothWheelZoom
(function () {
    L.Map.SmoothWheelZoom = L.Handler.extend({
        addHooks: function () {
            L.DomEvent.on(this._map._container, 'wheel', this._onWheelScroll, this);
        },
        removeHooks: function () {
            L.DomEvent.off(this._map._container, 'wheel', this._onWheelScroll, this);
        },
        _onWheelScroll: function (e) {
            if (!this._isWheeling) this._onWheelStart(e);
            this._onWheeling(e);
        },
        _onWheelStart: function (e) {
            var map = this._map;
            this._isWheeling = true;
            this._zoom = map.getZoom();
            this._wheelMousePosition = map.mouseEventToContainerPoint(e);
        },
        _onWheeling: function (e) {
            var map = this._map;
            var delta = L.DomEvent.getWheelDelta(e);
            var sensitivity = map.options.smoothSensitivity || 1;
            this._zoom = Math.max(map.getMinZoom(), Math.min(map.getMaxZoom(), this._zoom + delta * sensitivity * 0.1));
            var mouseLatLng = map.containerPointToLatLng(map.mouseEventToContainerPoint(e));
            map.setView(mouseLatLng, this._zoom, { animate: false });
            clearTimeout(this._endTimeout);
            this._endTimeout = setTimeout(L.Util.bind(this._onWheelEnd, this), 200);
            L.DomEvent.stop(e);
        },
        _onWheelEnd: function () {
            this._isWheeling = false;
        }
    });
    L.Map.mergeOptions({ smoothWheelZoom: false, smoothSensitivity: 1 });
    L.Map.addInitHook(function () {
        if (this.options.smoothWheelZoom) {
            this.smoothWheelZoom = new L.Map.SmoothWheelZoom(this);
            this.smoothWheelZoom.enable();
        }
    });
})();
