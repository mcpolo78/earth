/**
 * events - a tiny event emitter, replacing the subset of Backbone.Events used by earth.
 *
 * Supports on(name, cb) / on({name: cb, ...}), off(), trigger(name, ...args), and listenTo/stopListening so a
 * component can drop all of its subscriptions to other emitters at once.
 */
export class Emitter {
    constructor() {
        this._handlers = new Map();
        this._listeningTo = [];
    }

    on(name, callback) {
        if (typeof name === "object") {
            for (const [key, cb] of Object.entries(name)) this.on(key, cb);
            return this;
        }
        if (!this._handlers.has(name)) this._handlers.set(name, []);
        this._handlers.get(name).push(callback);
        return this;
    }

    off(name, callback) {
        if (name === undefined) {
            this._handlers.clear();
            return this;
        }
        const list = this._handlers.get(name);
        if (list) {
            this._handlers.set(name, callback ? list.filter(cb => cb !== callback) : []);
        }
        return this;
    }

    trigger(name, ...args) {
        const list = this._handlers.get(name);
        if (list) {
            for (const cb of [...list]) cb.apply(this, args);
        }
        return this;
    }

    listenTo(other, name, callback) {
        const pairs = typeof name === "object" ? Object.entries(name) : [[name, callback]];
        for (const [key, cb] of pairs) {
            other.on(key, cb);
            this._listeningTo.push([other, key, cb]);
        }
        return this;
    }

    stopListening() {
        for (const [other, key, cb] of this._listeningTo) other.off(key, cb);
        this._listeningTo = [];
        return this;
    }
}
