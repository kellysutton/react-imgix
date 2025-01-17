import PropTypes from "prop-types";
import React, { Component } from "react";
import "./array-findindex";
import { config } from "./common";
import { PACKAGE_VERSION } from "./constants";
import constructUrl, {
  compactParamKeys,
  extractClientAndPathComponents,
} from "./constructUrl";
import extractQueryParams from "./extractQueryParams";
import { ShouldComponentUpdateHOC } from "./HOCs";
import { mergeComponentPropsHOF, processPropsHOF } from "./HOFs";

const NODE_ENV = process.env.NODE_ENV;

const buildKey = (idx) => `react-imgix-${idx}`;

const defaultImgixParams = {
  auto: ["format"],
};

const defaultAttributeMap = {
  src: "src",
  srcSet: "srcSet",
  sizes: "sizes",
};

const noop = () => {};

const COMMON_PROP_TYPES = {
  className: PropTypes.string,
  onMounted: PropTypes.func,
  htmlAttributes: PropTypes.object,
  alt: PropTypes.string,
};

const SHARED_IMGIX_AND_SOURCE_PROP_TYPES = Object.assign(
  {},
  COMMON_PROP_TYPES,
  {
    disableQualityByDPR: PropTypes.bool,
    disableSrcSet: PropTypes.bool,
    disableLibraryParam: PropTypes.bool,
    disablePathEncoding: PropTypes.bool,
    imgixParams: PropTypes.object,
    sizes: PropTypes.string,
    width: PropTypes.number,
    height: PropTypes.number,
    src: PropTypes.string.isRequired,
    srcSetOptions: PropTypes.shape({
      widths: PropTypes.arrayOf(PropTypes.number),
      widthTolerance: PropTypes.number,
      minWidth: PropTypes.number,
      maxWidth: PropTypes.number,
      devicePixelRatios: PropTypes.arrayOf(PropTypes.number),
    }),
  }
);

const REACT_IMGIX_PROP_TYPES = Object.assign(
  {},
  SHARED_IMGIX_AND_SOURCE_PROP_TYPES,
  {
    alt: PropTypes.string,
  }
);

const OVERSIZE_IMAGE_TOLERANCE = 500;

let performanceObserver;

/**
 * Validates that an aspect ratio is in the format w:h. If false is returned, the aspect ratio is in the wrong format.
 */
function aspectRatioIsValid(aspectRatio) {
  if (typeof aspectRatio !== "string") {
    return false;
  }

  return /^\d+(\.\d+)?:\d+(\.\d+)?$/.test(aspectRatio);
}

const setParentRef = (parentRef, el) => {
  if (!parentRef) {
    return;
  }

  // assign ref based on if it's a callback vs object
  if (typeof parentRef === "function") {
    parentRef(el);
  } else {
    parentRef.current = el;
  }
};

function buildSrcSet(rawSrc, params = {}, options = {}) {
  const { client, pathComponents } = extractClientAndPathComponents(rawSrc);
  const compactedParams = compactParamKeys(params);
  return client.buildSrcSet(pathComponents.join("/"), compactedParams, options);
}

/**
 * Build a imgix source url with parameters from a raw url
 */
function buildSrc({
  src: inputSrc,
  width,
  height,
  disableLibraryParam,
  disableSrcSet,
  disablePathEncoding,
  imgixParams,
  disableQualityByDPR,
  srcSetOptions,
}) {
  const fixedSize = width != null || height != null;

  const [rawSrc, params] = extractQueryParams(inputSrc);

  const srcImgixParams = Object.assign(
    {},
    params,
    imgixParams,
    disableLibraryParam ? {} : { ixlib: `react-${PACKAGE_VERSION}` },
    fixedSize && height ? { height } : {},
    fixedSize && width ? { width } : {}
  );

  const srcOptions = {
    disablePathEncoding,
  };

  const src = constructUrl(rawSrc, srcImgixParams, srcOptions);

  let srcSet;

  if (disableSrcSet) {
    srcSet = src;
  } else {
    const sharedSrcSetOptions = Object.assign({}, srcSetOptions, {
      disablePathEncoding,
    });
    if (fixedSize) {
      const { width, w, height, h, q, ...urlParams } = srcImgixParams;
      if (q) {
        urlParams["q"] = q;
      }

      const finalWidth = width || w;
      const finalHeight = height || h;

      if (finalWidth) {
        urlParams["w"] = finalWidth;
      }

      if (finalHeight) {
        urlParams["h"] = finalHeight;
      }

      srcSet = buildSrcSet(
        rawSrc,
        urlParams,
        Object.assign(
          { disableVariableQuality: disableQualityByDPR },
          sharedSrcSetOptions
        )
      );
    } else {
      const { width, w, height, h, ...urlParams } = srcImgixParams;

      const aspectRatio = imgixParams.ar;
      let showARWarning =
        aspectRatio != null && aspectRatioIsValid(aspectRatio) === false;

      srcSet = buildSrcSet(rawSrc, urlParams, sharedSrcSetOptions);

      if (
        NODE_ENV !== "production" &&
        showARWarning &&
        config.warnings.invalidARFormat
      ) {
        console.warn(
          `[Imgix] The aspect ratio passed ("${aspectRatio}") is not in the correct format. The correct format is "W:H".`
        );
      }
    }
  }

  return {
    src,
    srcSet,
  };
}

/**
 * Use the PerformanceObserver API to warn if an LCP element is loaded lazily.
 */
function watchForLazyLCP(imgRef) {
  if (
    !performanceObserver &&
    typeof window !== 'undefined' &&
    window.PerformanceObserver
  ) { 
    performanceObserver = new PerformanceObserver((entryList) => {
      const entries = entryList.getEntries();

      if (entries.length === 0) {
        return;
      }

      // The most recent LCP entry is the only one that can be the real LCP element.
      const lcpCandidate = entries[entries.length - 1];
      if (lcpCandidate.element?.getAttribute("loading") === "lazy") {
        console.warn(
          `An image with URL ${imgRef.src} was detected as a possible LCP element (https://web.dev/lcp) ` + 
          `and also has 'loading="lazy"'. This can have a significant negative impact on page loading performance. ` +
          `Lazy loading is not recommended for images which may render in the initial viewport.` );
      }
    });
    performanceObserver.observe({type: 'largest-contentful-paint', buffered: true});
  }
}

/**
 * Once the image is loaded, warn if it's intrinsic size is much larger than its rendered size.
 */
function checkImageSize(imgRef) {
  const renderedWidth = imgRef.clientWidth;
  const renderedHeight = imgRef.clientHeight;
  const intrinsicWidth = imgRef.naturalWidth;
  const intrinsicHeight = imgRef.naturalHeight;

  if (
    intrinsicWidth > renderedWidth + OVERSIZE_IMAGE_TOLERANCE ||
    intrinsicHeight > renderedHeight + OVERSIZE_IMAGE_TOLERANCE
  ) {
    console.warn(
      `An image with URL ${imgRef.src} was rendered with dimensions significantly smaller than intrinsic size, ` +
      `which can slow down page loading. This may be caused by a missing or inaccurate "sizes" property. ` + 
      `Rendered size: ${renderedWidth}x${renderedHeight}. Intrinsic size: ${intrinsicWidth}x${intrinsicHeight}.`
    );
  }
}

/**
 * Initializes listeners for performance-related image warnings
 */
function doPerformanceChecksOnLoad(imgRef) {
  // Check image size on load
  if(config.warnings.oversizeImage) {
    if (imgRef.complete) {
      checkImageSize(imgRef);
    } else {
      imgRef.addEventListener('load', () => {
        checkImageSize(imgRef);
      });
    }
  }
  if(config.warnings.lazyLCP) {
    watchForLazyLCP(imgRef);
  }
}

/**
 * Combines default imgix params with custom imgix params to make a imgix params config object
 */
function imgixParams(props) {
  const params = Object.assign({}, defaultImgixParams, props.imgixParams);
  return Object.assign({}, params);
}

/**
 * React component used to render <img> elements with Imgix
 */
class ReactImgix extends Component {
  static propTypes = Object.assign({}, REACT_IMGIX_PROP_TYPES);
  static defaultProps = {
    disableSrcSet: false,
    onMounted: noop,
  };

  constructor(props) {
    super(props);
    this.imgRef = null;
  }

  componentDidMount() {
    if (NODE_ENV === 'development' && this.imgRef) {
      doPerformanceChecksOnLoad(this.imgRef);
    }
    this.props.onMounted(this.imgRef);
  }

  render() {
    const { disableSrcSet, width, height } = this.props;

    // Pre-render checks
    if (NODE_ENV !== "production" && config.warnings.sizesAttribute) {
      if (
        this.props.width == null &&
        this.props.height == null &&
        this.props.sizes == null &&
        !this.props._inPicture
      ) {
        console.warn(
          "If width and height are not set, a sizes attribute should be passed."
        );
      }
    }

    const { src, srcSet } = buildSrc(
      Object.assign({}, this.props, {
        type: "img",
        imgixParams: imgixParams(this.props),
      })
    );

    const attributeConfig = Object.assign(
      {},
      defaultAttributeMap,
      this.props.attributeConfig
    );

    const fixedSize = !!(
      (width || this.props.htmlAttributes?.width) &&
      (height || this.props.htmlAttributes?.height)
    );
    let adjustedSizes = this.props.sizes;
    if (this.props.sizes && this.props.htmlAttributes?.loading === "lazy" && !fixedSize) {
      adjustedSizes = "auto, " + adjustedSizes ?? "";
    }

    const childProps = Object.assign({}, this.props.htmlAttributes, {
      [attributeConfig.sizes]: adjustedSizes,
      className: this.props.className,
      width: width <= 1 ? null : width ?? this.props.htmlAttributes?.width,
      height: height <= 1 ? null : height ?? this.props.htmlAttributes?.height,
      [attributeConfig.src]: src,
      ref: (el) => {
        this.imgRef = el;
        if (
          this.props.htmlAttributes !== undefined &&
          "ref" in this.props.htmlAttributes
        ) {
          setParentRef(this.props.htmlAttributes.ref, this.imgRef);
        }
      },
    });
    if (!disableSrcSet) {
      childProps[attributeConfig.srcSet] = srcSet;
    }
    if (this.props.alt) {
      childProps.alt = this.props.alt;
    }

    return <img {...childProps} />;
  }
}
ReactImgix.displayName = "ReactImgix";

/**
 * React component used to render <picture> elements with Imgix
 */
class PictureImpl extends Component {
  static propTypes = Object.assign({}, COMMON_PROP_TYPES, {
    children: PropTypes.any,
  });
  static defaultProps = {
    onMounted: noop,
  };

  constructor(props) {
    super(props);
    this.pictureRef = null;
  }

  componentDidMount() {
    this.props.onMounted(this.pictureRef);
  }

  render() {
    const { children } = this.props;

    // make sure all of our children have key set, otherwise we get react warnings
    let _children =
      React.Children.map(children, (child, idx) => {
        const childIsReactImgix =
          child.type?.name === "mergeComponentPropsHOFInner";
        return React.cloneElement(
          child,
          Object.assign(
            {
              key: buildKey(idx),
            },
            // This prevents props._inPicture being set on other children if
            // they're passed, such as an <img> component, which will cause a
            // React error
            childIsReactImgix && {
              _inPicture: true,
            }
          )
        );
      }) || [];

    /*
    We need to make sure an <img /> or <Imgix /> is the last child so we look for one in children
      a. if we find one, move it to the last entry if it's not already there
      b. if we don't find one, warn the user as they probably want to pass one.
    */

    // look for an <img> or <ReactImgix type='img'> - at the bare minimum we have to have a single <img> element or else it will not work.
    let imgIdx = _children.findIndex(
      (c) =>
        c.type === "img" ||
        c.type === ReactImgix ||
        c.type === ReactImgixWrapped
    );

    if (imgIdx === -1 && config.warnings.fallbackImage) {
      console.warn(
        "No fallback <img /> or <Imgix /> found in the children of a <picture> component. A fallback image should be passed to ensure the image renders correctly at all dimensions."
      );
    } else if (imgIdx !== _children.length - 1) {
      // found one, need to move it to the end
      _children.push(_children.splice(imgIdx, 1)[0]);
    }

    return (
      <picture ref={(el) => (this.pictureRef = el)} children={_children} />
    );
  }
}
PictureImpl.displayName = "ReactImgixPicture";

/**
 * React component used to render <source> elements with Imgix
 */
class SourceImpl extends Component {
  static propTypes = Object.assign({}, SHARED_IMGIX_AND_SOURCE_PROP_TYPES);
  static defaultProps = {
    disableSrcSet: false,
    onMounted: noop,
  };

  constructor(props) {
    super(props);
    this.sourceRef = null;
  }

  componentDidMount() {
    this.props.onMounted(this.sourceRef);
  }

  render() {
    const { disableSrcSet, width, height } = this.props;

    const { src, srcSet } = buildSrc(
      Object.assign({}, this.props, {
        type: "source",
        imgixParams: imgixParams(this.props),
      })
    );

    const attributeConfig = Object.assign(
      {},
      defaultAttributeMap,
      this.props.attributeConfig
    );
    const childProps = Object.assign({}, this.props.htmlAttributes, {
      [attributeConfig.sizes]: this.props.sizes,
      className: this.props.className,
      width: width <= 1 ? null : width ?? this.props.htmlAttributes?.width,
      height: height <= 1 ? null : height ?? this.props.htmlAttributes?.height,
      ref: (el) => {
        this.sourceRef = el;
        if (
          this.props.htmlAttributes !== undefined &&
          "ref" in this.props.htmlAttributes
        ) {
          setParentRef(this.props.htmlAttributes.ref, this.sourceRef);
        }
      },
    });

    // inside of a <picture> element a <source> element ignores its src
    // attribute in favor of srcSet so we set that with either an actual
    // srcSet or a single src
    if (disableSrcSet) {
      childProps[attributeConfig.srcSet] = src;
    } else {
      childProps[attributeConfig.srcSet] = `${srcSet}`;
    }
    // for now we'll take media from htmlAttributes which isn't ideal because
    //   a) this isn't an <img>
    //   b) passing objects as props means that react will always rerender
    //      since objects dont respond correctly to ===

    return <source {...childProps} />;
  }
}
SourceImpl.displayName = "ReactImgixSource";

const ReactImgixWrapped = mergeComponentPropsHOF(
  processPropsHOF(ShouldComponentUpdateHOC(ReactImgix))
);
const Picture = mergeComponentPropsHOF(
  processPropsHOF(ShouldComponentUpdateHOC(PictureImpl))
);
const Source = mergeComponentPropsHOF(
  processPropsHOF(ShouldComponentUpdateHOC(SourceImpl))
);

export default ReactImgixWrapped;
export {
  ReactImgix as __ReactImgixImpl,
  Picture,
  Source,
  SourceImpl as __SourceImpl,
  PictureImpl as __PictureImpl, // for testing
};
