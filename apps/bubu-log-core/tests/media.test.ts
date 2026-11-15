import { expect, it } from 'vitest';
import { replaceMedia, photoUrls } from '../src/media';
it('rewrites complete URLs without corrupting prefix-sharing audit photos', () => {
  const url='https://photos.test/a.png', other=url+'?ver=2', uri='bubu-attachment:att_'+'a'.repeat(64);
  expect(replaceMedia({poopPhotoUrl:other,before:{poopPhotoUrl:url},text:`photo ${url}, next ${other}`,json:JSON.stringify({old:url,other})},url,uri)).toEqual({poopPhotoUrl:other,before:{poopPhotoUrl:uri},text:`photo ${uri}, next ${other}`,json:JSON.stringify({old:uri,other})});
  expect(photoUrls([{poopPhotoUrl:url},{states:{poopPhotoUrl:'known'}},{before:JSON.stringify({poopPhotoUrl:other})}])).toEqual([url,other]);
});
