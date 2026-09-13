import { useEffect, useRef, useState } from 'react';
import { JwtProvider, useJwt } from './context/JwtContext';
import { MissingJwt } from './components/MissingJwt';
import { ExitConfirm } from './components/ExitConfirm';
import { WarningSheet } from './components/WarningSheet';
import { Landing } from './steps/Landing';
import { Tips } from './steps/Tips';
import { Processing } from './steps/Processing';
import { Preview } from './steps/Preview';
import { templates } from './data/templates';
import { getProfile } from './services/profile';
import { createPostByImageUrl, createPostWithFile } from './services/createPost';
import { redirectWithJwt } from './utils/redirect';
import { config } from './config';
import type { CompositeResult, Profile, Step } from './types';

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
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);

  // On a failed composite, Retake/Reupload should reopen the same source the photo came from.
  function repickPhoto() {
    if (photoSource === 'capture') cameraInputRef.current?.click();
    else galleryInputRef.current?.click();
  }

  useEffect(() => {
    getProfile(jwt).then((fetched) => {
      setProfile(fetched);
      if (fetched.username) {
        setName(fetched.username);
      }
    });
  }, [jwt]);

  const selectedTemplate = templates.find((template) => template.id === templateId) ?? templates[0];

  function handleFileSelected(file: File) {
    setPhoto(file);
    setPhotoSource('upload');
    setStep('processing');
  }

  function handleCaptured(blob: Blob) {
    setPhoto(blob);
    setPhotoSource('capture');
    setStep('processing');
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
          onNameChange={setName}
          selectedTemplateId={templateId}
          onSelectTemplate={setTemplateId}
          onCapture={() => setStep('tips')}
          onFileSelected={handleFileSelected}
          onBack={() => setShowExitConfirm(true)}
        />
      )}
      {step === 'tips' && (
        <Tips onProceed={() => cameraInputRef.current?.click()} onBack={() => setStep('landing')} />
      )}
      {/* Native camera: `capture` opens the device camera directly on iOS and Android. */}
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
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
          onHome={() => redirectWithJwt(config.homeUrl, jwt)}
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
          onPost={handlePost}
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
