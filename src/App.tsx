import { useEffect, useRef, useState } from 'react';
import { JwtProvider, useJwt } from './context/JwtContext';
import { MissingJwt } from './components/MissingJwt';
import { ExitConfirm } from './components/ExitConfirm';
import { WarningSheet } from './components/WarningSheet';
import { Landing } from './steps/Landing';
import { Tips } from './steps/Tips';
import { Processing } from './steps/Processing';
import { Preview } from './steps/Preview';
import { Adjust } from './steps/Adjust';
import { templates } from './data/templates';
import { getProfile } from './services/profile';
import { createPostByImageUrl, createPostWithFile } from './services/createPost';
import { fetchCutout, compositeCutout, CompositeError } from './services/composite';
import { downscaleImage } from './utils/downscaleImage';
import { redirectWithJwt } from './utils/redirect';
import { isNativeApp, openCamera, openGallery, NativeMediaError } from './services/nativeBridge';
import { isAndroidWebView } from './utils/userAgent';
import { config } from './config';
import type { CompositeResult, CutoutResult, Profile, Rect, Step } from './types';

const EMPTY_PROFILE: Profile = {
  username: '',
  email: '',
  mobileno: '',
  state: '',
  constituency: '',
  district: '',
};

function Flow() {
  const jwt = useJwt();
  const [step, setStep] = useState<Step>('landing');
  const [name, setName] = useState('');
  const [profile, setProfile] = useState<Profile>(EMPTY_PROFILE);
  const [templateId, setTemplateId] = useState(templates[0].id);
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [photoSource, setPhotoSource] = useState<'upload' | 'capture'>('upload');
  const [composited, setComposited] = useState<CompositeResult | null>(null);
  const [wish, setWish] = useState('');
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);
  const [showExitConfirm, setShowExitConfirm] = useState(false);
  const [processedToast, setProcessedToast] = useState(false);
  const [overlapWarning, setOverlapWarning] = useState(false);
  const [cutout, setCutout] = useState<CutoutResult | null>(null);
  const [preparingAdjust, setPreparingAdjust] = useState(false);
  const [adjustBusy, setAdjustBusy] = useState(false);
  const [adjustError, setAdjustError] = useState<string | null>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  // Once the user edits the name, never let a late-arriving profile fetch overwrite it.
  const nameTouched = useRef(false);

  // The Adjust screen needs a real /cutout + /composite backend; hide it in the mock demo flow.
  const adjustEnabled = !config.useMockComposite;

  // Inside the NaMo app WebView we open the device camera/gallery through the native bridge; in a
  // plain browser this is false and the hidden <input type="file"> below is used instead.
  const nativeApp = isNativeApp();

  function handleNameChange(value: string) {
    nameTouched.current = true;
    setName(value);
  }

  // Native camera path: ask the app to open its camera, then feed the returned photo into the same
  // pipeline the file input uses. A cancel/timeout rejects; we just stay on the current screen.
  async function startNativeCapture() {
    try {
      const blob = await openCamera();
      await handleCaptured(blob);
    } catch (err) {
      // The user backing out is final -- do nothing. Any other native failure (the app returned no
      // image, an unreadable one, a timeout, or no bridge) falls back to the file picker so the user
      // can still add a photo instead of being stuck.
      if (err instanceof NativeMediaError && err.reason === 'cancelled') return;
      cameraInputRef.current?.click();
    }
  }

  // Native gallery path: same as above but flagged as an upload (not a capture).
  async function startNativeUpload() {
    try {
      const blob = await openGallery();
      await handleFileSelected(blob);
    } catch (err) {
      if (err instanceof NativeMediaError && err.reason === 'cancelled') return;
      galleryInputRef.current?.click();
    }
  }

  // On a failed composite, Retake/Reupload should reopen the same source the photo came from.
  function repickPhoto() {
    if (nativeApp) {
      void (photoSource === 'capture' ? startNativeCapture() : startNativeUpload());
      return;
    }
    if (photoSource === 'capture') cameraInputRef.current?.click();
    else galleryInputRef.current?.click();
  }

  useEffect(() => {
    getProfile(jwt).then((fetched) => {
      setProfile(fetched);
      // Prefill from the profile only if the user hasn't already typed a name (the fetch can resolve
      // after the user has edited it, which would otherwise clobber their edit back to the JWT name).
      if (fetched.username && !nameTouched.current) {
        setName(fetched.username);
      }
    });
  }, [jwt]);

  const selectedTemplate = templates.find((template) => template.id === templateId) ?? templates[0];

  async function handleFileSelected(file: Blob) {
    const photo = await downscaleImage(file);
    setPhoto(photo);
    setPhotoSource('upload');
    setStep('processing');
  }

  async function handleCaptured(blob: Blob) {
    const photo = await downscaleImage(blob);
    setPhoto(photo);
    setPhotoSource('capture');
    setStep('processing');
  }

  // From Preview: remove the background (once) and open the Adjust screen with the cutout.
  async function handleStartAdjust() {
    if (!photo || preparingAdjust) return;
    setPreparingAdjust(true);
    setPostError(null);
    try {
      const result = await fetchCutout({ photo, templateId, jwt });
      setCutout(result);
      setAdjustError(null);
      setStep('adjust');
    } catch (err) {
      const failure = err instanceof CompositeError ? err : null;
      setPostError(
        failure?.code === 'no_face'
          ? "We couldn't find a face in your photo."
          : failure?.code === 'multiple_faces'
            ? 'We found more than one person in the photo.'
            : "We couldn't prepare your photo for adjusting. Please try again.",
      );
    } finally {
      setPreparingAdjust(false);
    }
  }

  // From Adjust: composite the cutout at the user's chosen box and return to Preview.
  async function handleApplyAdjust(box: Rect) {
    if (!cutout) return;
    setAdjustBusy(true);
    setAdjustError(null);
    try {
      const result = await compositeCutout({
        cutout: cutout.blob,
        box,
        templateId,
        profile: { ...profile, username: name },
        jwt,
      });
      setComposited(result);
      setOverlapWarning(result.warning === 'text-overlap');
      setProcessedToast(false);
      setStep('preview');
    } catch {
      setAdjustError("We couldn't apply your changes. Please try again.");
    } finally {
      setAdjustBusy(false);
    }
  }

  async function handlePost() {
    if (!composited) return;
    setPosting(true);
    setPostError(null);

    const result = composited.imageUrl
      ? await createPostByImageUrl({ jwt, text: wish, imageUrl: composited.imageUrl, templateId })
      : await createPostWithFile({ jwt, text: wish, imageBlob: composited.imageBlob as Blob });

    setPosting(false);

    if (result.ok) {
      redirectWithJwt(config.mediaWallUrl, jwt);
    } else {
      setPostError("We couldn't post your card. Please try again.");
    }
  }

  return (
    <>
      {step === 'landing' && (
        <Landing
          name={name}
          onNameChange={handleNameChange}
          selectedTemplateId={templateId}
          onSelectTemplate={setTemplateId}
          onCapture={() => setStep('tips')}
          onFileSelected={handleFileSelected}
          onUpload={nativeApp ? startNativeUpload : undefined}
          onBack={() => setShowExitConfirm(true)}
        />
      )}
      {step === 'tips' && (
        <Tips
          onProceed={() => (nativeApp ? void startNativeCapture() : cameraInputRef.current?.click())}
          onBack={() => setStep('landing')}
        />
      )}
      {/* Camera path. In browsers `capture` opens the native camera directly (without it, Chrome on
          Android 13+ shows the photo picker, which has no camera option). Android WebViews (the NaMo
          app) often ignore `capture` and leave the user stuck, so there the plain picker opens instead,
          from which the user can choose Camera. */}
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture={isAndroidWebView(navigator.userAgent) ? undefined : 'environment'}
        hidden
        data-testid="camera-input"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) {
            handleCaptured(file);
          }
          event.target.value = '';
        }}
      />
      {/* Gallery picker, so Reupload after an error can reopen it without going back to Landing. */}
      <input
        ref={galleryInputRef}
        type="file"
        accept="image/*"
        hidden
        data-testid="gallery-input"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) {
            handleFileSelected(file);
          }
          event.target.value = '';
        }}
      />
      {step === 'processing' && photo && (
        <Processing
          jwt={jwt}
          photo={photo}
          template={selectedTemplate}
          profile={{ ...profile, username: name }}
          photoSource={photoSource}
          onComposited={(result) => {
            setComposited(result);
            setProcessedToast(true);
            setOverlapWarning(result.warning === 'text-overlap');
            setStep('preview');
          }}
          onError={repickPhoto}
          onRestart={() => setStep('landing')}
          onHome={() => setStep('landing')}
        />
      )}
      {step === 'preview' && composited && (
        <Preview
          composited={composited}
          wish={wish}
          onWishChange={setWish}
          posting={posting}
          postError={postError}
          photoSource={photoSource}
          showProcessedToast={processedToast}
          onDismissToast={() => setProcessedToast(false)}
          onBack={() => setStep('landing')}
          onRetake={repickPhoto}
          onAdjust={adjustEnabled && photo ? handleStartAdjust : undefined}
          adjusting={preparingAdjust}
          onPost={handlePost}
        />
      )}
      {step === 'adjust' && cutout && (
        <Adjust
          template={selectedTemplate}
          cutout={cutout}
          busy={adjustBusy}
          error={adjustError}
          onCancel={() => {
            setAdjustError(null);
            setStep('preview');
          }}
          onApply={handleApplyAdjust}
        />
      )}
      {step === 'preview' && overlapWarning && (
        <WarningSheet
          retakeLabel={photoSource === 'capture' ? 'Retake' : 'Reupload'}
          onIgnore={() => setOverlapWarning(false)}
          onRetake={() => {
            setOverlapWarning(false);
            repickPhoto();
          }}
        />
      )}
      {showExitConfirm && (
        <ExitConfirm
          onConfirm={() => redirectWithJwt(config.homeUrl, jwt)}
          onCancel={() => setShowExitConfirm(false)}
        />
      )}
    </>
  );
}

type AppProps = {
  search?: string;
};

export function App({ search = window.location.search }: AppProps) {
  return (
    <JwtProvider search={search} missingJwtFallback={<MissingJwt />}>
      <Flow />
    </JwtProvider>
  );
}
