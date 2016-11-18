import ReactDOM from 'react-dom'
import React, {Component, PropTypes} from 'react'
import { deprecate } from 'react-is-deprecated'

import processImage from './support.js'

const roundToNearest = (size, precision) => precision * Math.ceil(size / precision)

const isStringNotEmpty = (str) => str && typeof str === 'string' && str.length > 0
const buildKey = (idx) => `react-imgix-${idx}`

const validTypes = ['bg', 'img', 'picture', 'source']

const defaultMap = {
  width: 'defaultWidth',
  height: 'defaultHeight'
}

const findSizeForDimension = (dim, props = {}, state = {}) => {
  if (props[dim]) {
    return props[dim]
  } else if (props.fluid && state[dim]) {
    return roundToNearest(state[dim], props.precision)
  } else if (props[defaultMap[dim]]) {
    return props[defaultMap[dim]]
  } else {
    return 1
  }
}

export default class ReactImgix extends Component {
  static propTypes = {
    aggressiveLoad: PropTypes.bool,
    auto: PropTypes.array,
    // we don't set this in defaultProps because then just referencing the variable
    // prints the deprecation notice and we only ever check for truthiness so
    // undefined and false are close enough.
    bg: deprecate(PropTypes.bool, 'bg is depracated, use type="bg" instead'),
    children: PropTypes.any,
    className: PropTypes.string,
    component: PropTypes.string,
    crop: PropTypes.string,
    customParams: PropTypes.object,
    entropy: PropTypes.bool,
    faces: PropTypes.bool,
    fit: PropTypes.string,
    fluid: PropTypes.bool,
    generateSrcSet: PropTypes.bool,
    src: PropTypes.string.isRequired,
    type: PropTypes.oneOf(validTypes)
  };
  static defaultProps = {
    aggressiveLoad: false,
    auto: ['format'],
    entropy: false,
    faces: true,
    fit: 'crop',
    fluid: true,
    generateSrcSet: true,
    precision: 100,
    type: 'img'
  };
  state = {
    width: null,
    height: null,
    mounted: false
  };

  forceLayout = () => {
    const node = ReactDOM.findDOMNode(this)
    this.setState({
      width: node.scrollWidth,
      height: node.scrollHeight,
      mounted: true
    })
  };

  componentDidMount = () => {
    this.forceLayout()
  };

  _findSizeForDimension = dim => findSizeForDimension(dim, this.props, this.state);

  render () {
    const {
      aggressiveLoad,
      auto,
      bg,
      children,
      component,
      customParams,
      crop,
      entropy,
      faces,
      fit,
      generateSrcSet,
      src,
      type,
      ...other
    } = this.props
    let _src = null
    let srcSet = null
    let _component = component

    let width = this._findSizeForDimension('width')
    let height = this._findSizeForDimension('height')

    let _crop = false
    if (faces) _crop = 'faces'
    if (entropy) _crop = 'entropy'
    if (crop) _crop = crop

    let _fit = false
    if (entropy) _fit = 'crop'
    if (fit) _fit = fit

    let _children = children

    if (this.state.mounted || aggressiveLoad) {
      const srcOptions = {
        auto: auto,
        ...customParams,
        crop: _crop,
        fit: _fit,
        width,
        height
      }

      _src = processImage(src, srcOptions)
      const dpr2 = processImage(src, {...srcOptions, dpr: 2})
      const dpr3 = processImage(src, {...srcOptions, dpr: 3})
      srcSet = `${dpr2} 2x, ${dpr3} 3x`
    }

    let childProps = {
      ...this.props.imgProps,
      className: this.props.className,
      width: other.width <= 1 ? null : other.width,
      height: other.height <= 1 ? null : other.height
    }

    // TODO: remove _type once bg option is gone
    const _type = bg ? 'bg' : type
    switch (_type) {
      case 'bg':
        if (!component) {
          _component = 'div'
        }
        childProps.style = {
          ...childProps.style,
          backgroundSize: 'cover',
          backgroundImage: isStringNotEmpty(_src) ? `url(${_src})` : null
        }
        break
      case 'img':
        if (!component) {
          _component = 'img'
        }

        if (generateSrcSet) {
          childProps.srcSet = srcSet
        }
        childProps.src = _src
        break
      case 'picture':
        if (!component) {
          _component = 'picture'
        }

        //
        // 2. we need to make sure an img is the last child so we look for one
        //    in children
        //    a. if we find one, move it to the last entry if it's not already there
        //    b. if we don't find one, create one.

        // make sure all of our children have key set, otherwise we get react warnings
        _children = React.Children.map(React.Children.toArray(children),
          (child, idx) => React.cloneElement(child, Object.assign({}, child.props, { key: buildKey(idx) }))
        )

        // look for an <img> or <ReactImgix type='img'> - if we don't find one
        // we'll have to add it in manually
        let imgIdx = _children.findIndex(c => (c.type === 'img' || ((c.type.hasOwnProperty('name') && c.type.name === 'ReactImgix') && c.props.type === 'img')))
        if (imgIdx === -1) {
          // didn't find one or empty array - either way make a new component to
          // put at the end. we pass in almost all of our props as defaults to
          // our children, exceptions are:
          //
          //    bg - only <source> and <img> elements are allowable as children of
          //         <picture> so we strip this option
          //    children - we don't want to get recursive here
          //    component - same reason as bg
          //    type - specifically we're adding an img type so we hard-code this,
          //           also letting type=picture through would infinitely loop

          //    TODO - what about css / class stuff? set on all the children or
          //    the parent? have to see how ie handles this since it just ignores
          //    the picture element and renders the <img>

          let imgProps = {
            aggressiveLoad,
            auto,
            customParams,
            crop,
            entropy,
            faces,
            fit,
            generateSrcSet,
            src,
            type: 'img',
            ...other,
            // make sure to set a unique key too
            key: buildKey(_children.length + 1)
          }

          // have to strip out props set to undefined since they will override
          // any defaultProps in the child
          Object.keys(imgProps).forEach(k => {
            if (imgProps[k] === undefined) delete imgProps[k]
          })

          _children.push(React.createElement(this.constructor, imgProps))
        } else if (imgIdx !== (_children.length - 1)) {
          // found one, need to move it to the end
          _children.splice(_children.length - 1, 0, _children.splice(imgIdx, 1)[0])
        }
        break
      default:
        // TODO - should we console.warn something here?
        break
    }
    return React.createElement(_component,
      childProps,
      _children)
  }
}
